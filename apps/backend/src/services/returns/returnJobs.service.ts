// apps/backend/src/services/returns/returnJobs.service.ts
//
// RETURN JOBS SERVICE
// -------------------
// Handles the full lifecycle of physical return processing.
//
// Two origins:
//   customer_return    — customer sent item back, refund_execution exists
//   undelivered_return — carrier returned package, no refund yet, linked to order
//
// Cascade chain on completion:
//   resellable   → stow_task created, inventory restored
//   repackable   → problem_center_task (type: repackaging_required)
//   damaged      → alert fired, ReturnsItemsPage "Needs your decision"
//   unsellable   → alert fired, write-off pending owner approval
//   undelivered  → order blocked (block_type: returned_undelivered), alert fired
//
// INVARIANTS:
//   - All writes inside withTenant transaction
//   - Inventory movement only fires AFTER item_condition = resellable
//   - One active undelivered_return job per order (enforced at service layer)
//   - Owner/admin only can set owner_decision
//   - Audit log on every state transition

import { Knex } from 'knex';
import db, { withTenant } from '@lasyncro/backend-core/db.js';
import { writeAuditLog } from '../audit/operatorAudit.service.js';
import { createStowTask } from '../wms/stow.service.js';
import { resolveBarcode } from '../../services/wms/barcodeResolution.service.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReturnJobOrigin = 'customer_return' | 'undelivered_return';
export type UndeliveredReason = 'wrong_address' | 'not_claimed' | 'customs' | 'carrier_error' | 'other';
export type CustomerReturnReason =
  | 'wrong_item' | 'damaged_in_transit' | 'damaged_on_arrival'
  | 'not_as_described' | 'quality_issue' | 'changed_mind'
  | 'duplicate_order' | 'other';
export type OwnerDecision = 'reship' | 'contact_customer' | 'initiate_refund' | 'write_off';
export type ItemCondition = 'resellable' | 'repackable' | 'damaged' | 'unsellable';

export interface CreateCustomerReturnJobInput {
  shopId: number;
  lasyncroRefundExecutionId: string;
  lasyncroOrderId: string;
  returnReason: CustomerReturnReason;
  returnNotes?: string;
  operatorId: number;
  notes?: string;
}

export interface CreateUndeliveredReturnJobInput {
  shopId: number;
  lasyncroOrderId: string;
  undeliveredReason: UndeliveredReason;
  operatorId: number;
  notes?: string;
}

export interface ClaimReturnJobInput {
  shopId: number;
  returnJobId: string;
  operatorId: number;
}

export interface ProcessReturnLineInput {
  shopId: number;
  returnJobId: string;
  refundLineItemId: string;
  itemCondition: ItemCondition;
  quantityReceived: number;
  conditionNotes?: string;
  operatorId: number;
}

export interface CompleteReturnJobInput {
  shopId: number;
  returnJobId: string;
  operatorId: number;
  returnReason?: CustomerReturnReason;
  returnNotes?: string;
}

export interface SetOwnerDecisionInput {
  shopId: number;
  returnJobId: string;
  decision: OwnerDecision;
  decisionNotes?: string;
  decidedBy: number;
}

export interface SetLineOwnerDecisionInput {
  shopId: number;
  lineItemId: string; // lasyncro_refund_line_item_id
  decision: OwnerDecision;
  decisionNotes?: string;
  decidedBy: number;
}

export interface ScanIntakeResult {
  returnJobId: string;
  status: string;
  isNew: boolean;
  claimedByOther: boolean;
}

// ─── Create: Undelivered Return, from Carrier Webhook ─────────────────────────
//
// RET-AUD service-layer task (2026-07-04). Closes the gap between
// carrier-integration.md's WM-40 return signal (parcel_tracking_events
// event_type='returned' → alerts row, see sendcloud/shippo.tracking
// .handler.ts) and an actual return_jobs row. Until this function, a
// carrier RTS event only ever produced an alert — no return_jobs row,
// no order block, no inventory/refund resolution path.
//
// Deliberately a SEPARATE function from createUndeliveredReturnJob, not
// an added parameter on it — see migration 0122's comment for why:
// this path has no human operator, and CreateUndeliveredReturnJobInput
// .operatorId stays required (`number`) for every genuinely
// operator-triggered call site. This function's own input type has no
// operatorId field at all — the absence is the honest signal, not a
// null passed where a real value was expected.
export interface CreateReturnJobFromCarrierEventInput {
  shopId: number;
  lasyncroOrderId: string;
  triggeringParcelTrackingEventId: string;
  notes?: string;
}

// ─── Create: Undelivered Return, from Carrier Webhook ─────────────────────────
//
// RET-AUD service-layer task (2026-07-04). Closes the gap between
// carrier-integration.md's WM-40 return signal (parcel_tracking_events
// event_type='returned' → alerts row) and an actual return_jobs row.
//
// UNLIKE every other function in this file, this one accepts an
// OPTIONAL external trx — following the qb = trx ?? db convention
// already established across the codebase (e.g. FinancesFacts.service.ts,
// ProductsWmsReadinessFacts.service.ts). This is necessary, not
// stylistic: sendcloud/shippo.tracking.handler.ts already open their
// own db.transaction() with correct SET LOCAL tenant context before
// calling this function. Calling withTenant() unconditionally here
// would open a SECOND, separate connection/transaction nested inside
// the handler's own — no atomicity between the two, and a second
// tenant-context SET on a possibly different pooled connection. See
// RLS_blueprint.md §7 ("Shopify sync fails with products/orders RLS
// violation") for the exact failure class this avoids.
//
// Still exported as a standalone-callable function (trx omitted) for
// any future caller that isn't already inside a transaction.
export interface CreateReturnJobFromCarrierEventInput {
  shopId: number;
  lasyncroOrderId: string;
  triggeringParcelTrackingEventId: string;
  notes?: string;
}

export interface CreateManualReturnLineInput {
  shopId: number;
  returnJobId: string;
  scannedValue: string; // product barcode, resolved via resolveBarcode
  quantityReceived: number;
  itemCondition: ItemCondition;
  conditionNotes?: string;
  operatorId: number;
}

// ─── Create: Customer Return ──────────────────────────────────────────────────

export async function createCustomerReturnJob(
  input: CreateCustomerReturnJobInput
): Promise<string> {
  
  const { shopId, lasyncroRefundExecutionId, lasyncroOrderId, operatorId, notes, returnReason, returnNotes } = input;
  
  return withTenant(shopId, async (trx) => {
    // Verify refund execution exists and belongs to this shop
    const refund = await trx('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .where('re.lasyncro_refund_execution_id', lasyncroRefundExecutionId)
      .where('o.shop_id', shopId)
      .select('re.lasyncro_refund_execution_id')
      .first();

    if (!refund) throw new Error(`[RETURN_JOB_CREATE] Refund execution not found: ${lasyncroRefundExecutionId}`);
    // Reason captured at operator intake — writes back to refund_executions,
    // the table of record for return_reason (RT2 reason taxonomy write path).
    await trx('refund_executions')
      .where('lasyncro_refund_execution_id', lasyncroRefundExecutionId)
      .update({
        return_reason: returnReason,
        return_notes: returnNotes ?? null,
      });

    const [job] = await trx('return_jobs')
      .insert({
        shop_id: shopId,
        origin: 'customer_return',
        lasyncro_refund_execution_id: lasyncroRefundExecutionId,
        lasyncro_order_id: lasyncroOrderId,
        status: 'pending',
        claimed_by: operatorId,
        claimed_at: new Date(),
        notes: notes ?? null,
      })
      .returning('return_job_id');

    const returnJobId = job.return_job_id ?? job;

    console.info('[RETURN_JOB_CREATED]', { returnJobId, shopId, origin: 'customer_return' });

    await writeAuditLog(trx as Knex.Transaction, {
      shopId,
      operatorId,
      actionType: 'return_job_create',
      entityType: 'return_job',
      entityId: returnJobId,
      metadata: { origin: 'customer_return', lasyncroRefundExecutionId },
    });

    return returnJobId;
  });
}

// ─── Create: Undelivered Return ───────────────────────────────────────────────

export async function createUndeliveredReturnJob(
  input: CreateUndeliveredReturnJobInput
): Promise<string> {
  const { shopId, lasyncroOrderId, undeliveredReason, operatorId, notes } = input;

  return withTenant(shopId, async (trx) => {
    // Invariant: one active undelivered_return job per order
    const existing = await trx('return_jobs')
      .where({ lasyncro_order_id: lasyncroOrderId, origin: 'undelivered_return' })
      .whereNotIn('status', ['complete'])
      .select('return_job_id')
      .first();

    if (existing) {
      throw new Error(`[RETURN_JOB_CREATE] Active undelivered return job already exists for order: ${lasyncroOrderId}`);
    }

    // Verify order belongs to this shop
    const order = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId, shop_id: shopId })
      .select('lasyncro_order_id')
      .first();

    if (!order) throw new Error(`[RETURN_JOB_CREATE] Order not found: ${lasyncroOrderId}`);

    const now = new Date();

    const [job] = await trx('return_jobs')
      .insert({
        shop_id: shopId,
        origin: 'undelivered_return',
        lasyncro_order_id: lasyncroOrderId,
        lasyncro_refund_execution_id: null,
        status: 'awaiting_decision',
        undelivered_reason: undeliveredReason,
        claimed_by: operatorId,
        claimed_at: now,
        notes: notes ?? null,
      })
      .returning('return_job_id');

    const returnJobId = job.return_job_id ?? job;

    // Block the order — returned_undelivered constraint
    // Uses order_constraints table (constraint_type: operational, block_type: returned_undelivered)
    await trx('order_constraints')
      .insert({
        shop_id: shopId,
        lasyncro_order_id: lasyncroOrderId,
        constraint_type: 'operational',
        block_type: 'returned_undelivered',
        target_id: returnJobId,
        started_at: now,
      })
      .onConflict(['lasyncro_order_id', 'constraint_type', 'target_id'])
      .ignore();

    console.info('[UNDELIVERED_RETURN_JOB_CREATED]', { returnJobId, shopId, lasyncroOrderId, undeliveredReason });

    await writeAuditLog(trx as Knex.Transaction, {
      shopId,
      operatorId,
      actionType: 'return_job_create',
      entityType: 'return_job',
      entityId: returnJobId,
      metadata: { origin: 'undelivered_return', lasyncroOrderId, undeliveredReason },
    });
    return returnJobId;
  });
}

export async function createReturnJobFromCarrierEvent(
  input: CreateReturnJobFromCarrierEventInput,
  trx?: Knex | Knex.Transaction
): Promise<string> {
  const { shopId, lasyncroOrderId, triggeringParcelTrackingEventId, notes } = input;

  const runWith = async (qb: Knex | Knex.Transaction): Promise<string> => {
    const existing = await qb('return_jobs')
      .where({ lasyncro_order_id: lasyncroOrderId, origin: 'undelivered_return' })
      .whereNotIn('status', ['complete'])
      .select('return_job_id')
      .first();
    if (existing) {
      console.info('[RETURN_JOB_CARRIER_EVENT_SKIPPED_EXISTING]', {
        shopId,
        lasyncroOrderId,
        existingReturnJobId: existing.return_job_id,
        triggeringParcelTrackingEventId,
      });
      return existing.return_job_id;
    }

    const order = await qb('orders')
      .where({ lasyncro_order_id: lasyncroOrderId, shop_id: shopId })
      .select('lasyncro_order_id')
      .first();
    if (!order) throw new Error(`[RETURN_JOB_CREATE_CARRIER_EVENT] Order not found: ${lasyncroOrderId}`);

    const now = new Date();
    const [job] = await qb('return_jobs')
      .insert({
        shop_id: shopId,
        origin: 'undelivered_return',
        lasyncro_order_id: lasyncroOrderId,
        lasyncro_refund_execution_id: null,
        status: 'awaiting_decision',
        // Closest fit of the existing UndeliveredReason enum — not
        // necessarily accurate fault attribution (migration 0123
        // usually can't say why), just the best available label.
        undelivered_reason: 'carrier_error',
        source: 'carrier_webhook',
        triggering_parcel_tracking_event_id: triggeringParcelTrackingEventId,
        claimed_by: null,
        claimed_at: null,
        notes: notes ?? null,
      })
      .returning('return_job_id');
    const returnJobId = job.return_job_id ?? job;

    await qb('order_constraints')
      .insert({
        shop_id: shopId,
        lasyncro_order_id: lasyncroOrderId,
        constraint_type: 'operational',
        block_type: 'returned_undelivered',
        target_id: returnJobId,
        started_at: now,
      })
      .onConflict(['lasyncro_order_id', 'constraint_type', 'target_id'])
      .ignore();

    console.info('[RETURN_JOB_CARRIER_EVENT_CREATED]', {
      returnJobId,
      shopId,
      lasyncroOrderId,
      triggeringParcelTrackingEventId,
    });

    // operatorId: null — see WriteAuditLogInput's decision record.
    await writeAuditLog(qb as Knex.Transaction, {
      shopId,
      operatorId: null,
      actionType: 'return_job_create',
      entityType: 'return_job',
      entityId: returnJobId,
      metadata: { origin: 'undelivered_return', source: 'carrier_webhook', lasyncroOrderId, triggeringParcelTrackingEventId },
    });

    return returnJobId;
  };

  if (trx) {
    return runWith(trx);
  }
  return withTenant(shopId, (innerTrx) => runWith(innerTrx));
}

// ─── Shared cascade — condition determines what happens next ─────────────────
// Used by both processReturnLine (existing refund-linked lines) and
// createManualReturnLine (scan-intake lines with no refund yet). Same
// physical item, same cascade — condition doesn't care where the line
// came from.
async function applyReturnLineCascade(
  trx: Knex | Knex.Transaction,
  input: { shopId: number; returnJobId: string; lasyncroVariantId: string; quantityReceived: number; itemCondition: ItemCondition }
): Promise<void> {
  const { shopId, returnJobId, lasyncroVariantId, quantityReceived, itemCondition } = input;
  const now = new Date();

  if (itemCondition === 'resellable') {
    await createStowTask(trx as Knex.Transaction, {
      shopId,
      lasyncroVariantId,
      quantity: quantityReceived,
      trigger: 'inbound_stock',
    });
    console.info('[RETURN_LINE_RESELLABLE]', { returnJobId, variantId: lasyncroVariantId, qty: quantityReceived });
  }

  if (itemCondition === 'repackable') {
    const seqResult = await trx.raw(`
      UPDATE shop_wms_settings
      SET prob_label_sequence = prob_label_sequence + 1, updated_at = NOW()
      WHERE shop_id = ?
      RETURNING prob_label_sequence, problem_bin_location
    `, [shopId]);
    const seqRow = seqResult.rows[0];
    const probLabel = `PROB-${shopId}-${String(seqRow.prob_label_sequence).padStart(4, '0')}`;
    const problemBin = seqRow.problem_bin_location ?? `WH-${shopId}-PROBLEM`;
    await trx('problem_center_tasks').insert({
      shop_id: shopId,
      status: 'open',
      source: 'returns',
      source_exception_id: returnJobId,
      lasyncro_variant_id: lasyncroVariantId,
      quantity: quantityReceived,
      exception_type: 'repackaging_required',
      problem_bin_location: problemBin,
      notes: probLabel,
    });
    console.info('[RETURN_LINE_REPACKABLE]', { returnJobId, variantId: lasyncroVariantId, probLabel });
  }

  if (itemCondition === 'damaged' || itemCondition === 'unsellable') {
    await trx('return_jobs')
      .where({ return_job_id: returnJobId })
      .update({ status: 'awaiting_decision', updated_at: now });
    console.info('[RETURN_LINE_FLAGGED]', { returnJobId, itemCondition, variantId: lasyncroVariantId });
  }
}

// ─── Process Line Item ────────────────────────────────────────────────────────
export async function processReturnLine(
  input: ProcessReturnLineInput
): Promise<void> {
  const { shopId, returnJobId, refundLineItemId, itemCondition, quantityReceived, conditionNotes, operatorId } = input;

  await withTenant(shopId, async (trx) => {
    // Validate job exists and is in progress
    const job = await trx('return_jobs')
      .where({ return_job_id: returnJobId, shop_id: shopId })
      .select('status', 'origin')
      .first();

    if (!job) throw new Error(`[RETURN_LINE_PROCESS] Job not found: ${returnJobId}`);
    if (!['pending', 'in_progress'].includes(job.status)) {
      throw new Error(`[RETURN_LINE_PROCESS] Job not processable: ${job.status}`);
    }

    // Fetch line item + variant for cascade
    const line = await trx('refund_execution_line_items as reli')
      .join('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .where('reli.lasyncro_refund_line_item_id', refundLineItemId)
      .select(
        'reli.lasyncro_refund_line_item_id',
        'reli.refunded_quantity',
        'oru.lasyncro_variant_id',
      )
      .first();

    if (!line) throw new Error(`[RETURN_LINE_PROCESS] Line item not found: ${refundLineItemId}`);

    const now = new Date();

    // Update line item condition
    await trx('refund_execution_line_items')
      .where({ lasyncro_refund_line_item_id: refundLineItemId })
      .update({
        item_condition: itemCondition,
        quantity_received: quantityReceived,
        condition_notes: conditionNotes ?? null,
        processed_by: operatorId,
        processed_at: now,
      });

    // Mark job in_progress
    await trx('return_jobs')
      .where({ return_job_id: returnJobId })
      .update({ status: 'in_progress', updated_at: now });

    // ── CASCADE ──────────────────────────────────────────────────────────────
    await applyReturnLineCascade(trx, {
      shopId,
      returnJobId,
      lasyncroVariantId: line.lasyncro_variant_id,
      quantityReceived,
      itemCondition,
    });

    // Shortfall detection — customer claimed more units than arrived
    if (quantityReceived < line.refunded_quantity) {
      const shortfall = line.refunded_quantity - quantityReceived;
      await trx('problem_center_tasks').insert({
        shop_id: shopId,
        status: 'open',
        source: 'returns',
        source_exception_id: returnJobId,
        lasyncro_variant_id: line.lasyncro_variant_id,
        quantity: shortfall,
        exception_type: 'return_shortfall',
        notes: `Customer claimed ${line.refunded_quantity} units, ${quantityReceived} arrived`,
      });
      console.info('[RETURN_SHORTFALL]', { returnJobId, claimed: line.refunded_quantity, received: quantityReceived });
    }

    await writeAuditLog(trx as Knex.Transaction, {
      shopId,
      operatorId,
      actionType: 'return_line_process',
      entityType: 'return_job',
      entityId: returnJobId,
      metadata: { refundLineItemId, itemCondition, quantityReceived, variantId: line.lasyncro_variant_id },
    });
  });
}

// ─── Complete Job ─────────────────────────────────────────────────────────────
export async function completeReturnJob(
  input: CompleteReturnJobInput
): Promise<void> {
  const { shopId, returnJobId, operatorId, returnReason, returnNotes } = input;
  await withTenant(shopId, async (trx) => {
    const job = await trx('return_jobs')
      .where({ return_job_id: returnJobId, shop_id: shopId })
      .select('status', 'origin', 'lasyncro_refund_execution_id')
      .first();
    if (!job) throw new Error(`[RETURN_JOB_COMPLETE] Job not found: ${returnJobId}`);
    if (job.status === 'awaiting_decision') {
      throw new Error(`[RETURN_JOB_COMPLETE] Job has items awaiting owner decision — cannot complete`);
    }
    // Reason required for customer_return jobs only — undelivered_return
    // has no customer decision involved, nothing to attribute a reason to.
    // Written to return_jobs unconditionally (WEB-RETURN-02 fix) — a
    // scan-intake job can complete before its refund webhook ever
    // arrives, so return_jobs is the only guaranteed-available target.
    // Also mirrored onto refund_executions immediately when a link
    // already exists, so existing readers of refund_executions.return_reason
    // stay correct without waiting on the reconciliation step.
    if (job.origin === 'customer_return') {
      if (!returnReason) {
        throw new Error(`[RETURN_JOB_COMPLETE] return_reason required to complete a customer_return job`);
      }
      if (job.lasyncro_refund_execution_id) {
        await trx('refund_executions')
          .where('lasyncro_refund_execution_id', job.lasyncro_refund_execution_id)
          .update({ return_reason: returnReason, return_notes: returnNotes ?? null });
      }
    }

    const now = new Date();
    await trx('return_jobs')
      .where({ return_job_id: returnJobId })
      .update({
        status: 'complete',
        completed_at: now,
        updated_at: now,
        return_reason: job.origin === 'customer_return' ? returnReason : null,
        return_notes: job.origin === 'customer_return' ? (returnNotes ?? null) : null,
      });
    
    console.info('[RETURN_JOB_COMPLETED]', { returnJobId, shopId, operatorId, returnReason });
    
    await writeAuditLog(trx as Knex.Transaction, {
      shopId,
      operatorId,
      actionType: 'return_job_complete',
      entityType: 'return_job',
      entityId: returnJobId,
      metadata: {},
    });
  });
}

// ─── Owner Decision ───────────────────────────────────────────────────────────
export async function setOwnerDecision(
  input: SetOwnerDecisionInput
): Promise<void> {
  const { shopId, returnJobId, decision, decisionNotes, decidedBy } = input;

  await withTenant(shopId, async (trx) => {
    const job = await trx('return_jobs')
      .where({ return_job_id: returnJobId, shop_id: shopId })
      .select('status', 'origin', 'lasyncro_order_id')
      .first();

    if (!job) throw new Error(`[OWNER_DECISION] Job not found: ${returnJobId}`);

    const now = new Date();

    await trx('return_jobs')
      .where({ return_job_id: returnJobId })
      .update({
        owner_decision: decision,
        decision_notes: decisionNotes ?? null,
        decision_by: decidedBy,
        decision_at: now,
        status: decision === 'reship' ? 'complete' : 'awaiting_decision',
        updated_at: now,
      });

    // ── CASCADE on decision ───────────────────────────────────────────────────

    if (decision === 'reship') {
      // Unblock order — remove returned_undelivered constraint
      await trx('order_constraints')
        .where({
          lasyncro_order_id: job.lasyncro_order_id,
          block_type: 'returned_undelivered',
          target_id: returnJobId,
        })
        .update({ resolved_at: now });

      console.info('[RETURN_DECISION_RESHIP]', { returnJobId, orderId: job.lasyncro_order_id });
    }

    if (decision === 'write_off') {
      // Fetch all damaged/unsellable line items for this job to write off inventory
      const lines = await trx('refund_execution_line_items as reli')
        .join('refund_executions as re', 're.lasyncro_refund_execution_id', 'reli.lasyncro_refund_execution_id')
        .where('re.lasyncro_order_id', job.lasyncro_order_id)
        .whereIn('reli.item_condition', ['damaged', 'unsellable'])
        .select('oru.lasyncro_variant_id', 'reli.quantity_received')
        .join('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id');

      for (const line of lines) {
        if (!line.quantity_received) continue;
        // Write-off inventory movement — negative quantity, distinct type for Finances traceability
        const { randomUUID } = await import('crypto');
        // Write-off location: problem bin if configured, else shop root
        const wmsSettings = await trx('shop_wms_settings')
          .where({ shop_id: shopId })
          .select('problem_bin_location')
          .first();
        const writeOffLocation = wmsSettings?.problem_bin_location ?? `WH-${shopId}-PROBLEM`;

        await trx('inventory_movements').insert({
          lasyncro_inventory_movement_id: randomUUID(),
          shop_id: shopId,
          lasyncro_variant_id: line.lasyncro_variant_id,
          location_code: writeOffLocation,
          movement_type: 'write_off_return',
          quantity_delta: -line.quantity_received,
          reference_id: returnJobId,
          reference_type: 'return_job',
          occurred_at: now,
          operator_id: decidedBy,       // traceability: owner/admin who made write-off decision
          triggered_by: 'manual',       // traceability: manual return processing
        });
        console.info('[RETURN_WRITE_OFF]', { returnJobId, variantId: line.lasyncro_variant_id, qty: line.quantity_received });
      }

      await trx('return_jobs')
        .where({ return_job_id: returnJobId })
        .update({ status: 'complete', completed_at: now, updated_at: now });
    }

    await writeAuditLog(trx as Knex.Transaction, {
      shopId,
      operatorId: decidedBy,
      actionType: 'return_decision_set',
      entityType: 'return_job',
      entityId: returnJobId,
      metadata: { decision, origin: job.origin },
    });
  });
}

// ─── Owner Decision — PER LINE (customer_return, damaged/unsellable) ─────────
//
// Replaces setOwnerDecision's per-JOB semantics for customer_return lines.
// A multi-line order can have different lines dispositioned differently
// (one reshipped, one written off) — setOwnerDecision incorrectly applied
// one decision to every damaged/unsellable line on the order at once.
// This scopes write-off (and any future per-line cascade) to exactly the
// one line passed in. Job auto-completes once every damaged/unsellable
// line on it has a decision — not on the first decision made.
export async function setLineOwnerDecision(
  input: SetLineOwnerDecisionInput
): Promise<void> {
  const { shopId, lineItemId, decision, decisionNotes, decidedBy } = input;

  await withTenant(shopId, async (trx) => {
    const line = await trx('refund_execution_line_items as reli')
      .leftJoin('refund_executions as re', 're.lasyncro_refund_execution_id', 'reli.lasyncro_refund_execution_id')
      .join('return_jobs as rj', function () {
        this.on('rj.return_job_id', '=', 'reli.return_job_id')
          .orOn('rj.lasyncro_refund_execution_id', '=', 'reli.lasyncro_refund_execution_id');
      })
      .where('reli.lasyncro_refund_line_item_id', lineItemId)
      .where('rj.shop_id', shopId)
      .select(
        'reli.lasyncro_refund_line_item_id',
        'reli.item_condition',
        'reli.quantity_received',
        'oru.lasyncro_variant_id',
        'rj.return_job_id',
        'rj.origin',
      )
      .join('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .first();

    if (!line) throw new Error(`[LINE_DECISION] Line item not found: ${lineItemId}`);
    if (!['damaged', 'unsellable'].includes(line.item_condition)) {
      throw new Error(`[LINE_DECISION] Line item condition does not require a decision: ${line.item_condition}`);
    }

    const now = new Date();

    await trx('refund_execution_line_items')
      .where({ lasyncro_refund_line_item_id: lineItemId })
      .update({
        owner_decision: decision,
        decision_notes: decisionNotes ?? null,
        decision_by: decidedBy,
        decision_at: now,
      });

    // ── CASCADE — scoped to THIS line only ──────────────────────────────────

    if (decision === 'write_off' && line.quantity_received) {
      const { randomUUID } = await import('crypto');
      const wmsSettings = await trx('shop_wms_settings')
        .where({ shop_id: shopId })
        .select('problem_bin_location')
        .first();
      const writeOffLocation = wmsSettings?.problem_bin_location ?? `WH-${shopId}-PROBLEM`;

      await trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: randomUUID(),
        shop_id: shopId,
        lasyncro_variant_id: line.lasyncro_variant_id,
        location_code: writeOffLocation,
        movement_type: 'write_off_return',
        quantity_delta: -line.quantity_received,
        reference_id: lineItemId, // line-scoped now, not the whole job
        reference_type: 'return_line_item',
        occurred_at: now,
        operator_id: decidedBy,
        triggered_by: 'manual',
      });
      console.info('[RETURN_LINE_WRITE_OFF]', { lineItemId, returnJobId: line.return_job_id, variantId: line.lasyncro_variant_id, qty: line.quantity_received });
    }

    if (decision === 'reship' && line.origin === 'undelivered_return') {
      // Only undelivered_return jobs carry the returned_undelivered order
      // constraint — a customer_return line has no such block to resolve.
      await trx('order_constraints')
        .where({ block_type: 'returned_undelivered', target_id: line.return_job_id })
        .update({ resolved_at: now });
    }

    // ── JOB COMPLETION — only once every damaged/unsellable line is decided ──
    const undecidedCount = await trx('refund_execution_line_items')
      .where({ return_job_id: line.return_job_id })
      .whereIn('item_condition', ['damaged', 'unsellable'])
      .whereNull('owner_decision')
      .count<{ count: string }>('lasyncro_refund_line_item_id as count')
      .first();

    if (Number(undecidedCount?.count ?? 0) === 0) {
      await trx('return_jobs')
        .where({ return_job_id: line.return_job_id })
        .update({ status: 'complete', completed_at: now, updated_at: now });
      console.info('[RETURN_JOB_ALL_LINES_DECIDED]', { returnJobId: line.return_job_id });
    }

    await writeAuditLog(trx as Knex.Transaction, {
      shopId,
      operatorId: decidedBy,
      actionType: 'return_line_decision_set',
      entityType: 'refund_execution_line_item',
      entityId: lineItemId,
      metadata: { decision, returnJobId: line.return_job_id, origin: line.origin },
    });
  });
}

// ─── List Jobs (mobile) ───────────────────────────────────────────────────────
export async function listReturnJobs(shopId: number): Promise<unknown[]> {
  return withTenant(shopId, async (trx) => {
    return trx('return_jobs as rj')
      .leftJoin('orders as o', 'o.lasyncro_order_id', 'rj.lasyncro_order_id')
      .leftJoin('external_order_identity_map as eoim', 'eoim.lasyncro_order_id', 'rj.lasyncro_order_id')
      .leftJoin('refund_executions as re', 're.lasyncro_refund_execution_id', 'rj.lasyncro_refund_execution_id')
      .where('rj.shop_id', shopId)
      .whereNotIn('rj.status', ['complete'])
      .select(
        'rj.return_job_id',
        'rj.origin',
        'rj.status',
        'rj.undelivered_reason',
        'rj.owner_decision',
        'rj.notes',
        'rj.created_at',
        'eoim.external_order_id',
        're.total_refund_amount',
        're.executed_at as refund_executed_at',
      )
      .orderBy('rj.created_at', 'asc');
  });
}

// ─── Get Single Job (web brief screen, WEB-RETURN-01) ─────────────────────────
export async function getReturnJob(
  shopId: number,
  returnJobId: string
): Promise<unknown | null> {
  return withTenant(shopId, async (trx) => {
    const job = await trx('return_jobs as rj')
      .leftJoin('orders as o', 'o.lasyncro_order_id', 'rj.lasyncro_order_id')
      .leftJoin('external_order_identity_map as eoim', 'eoim.lasyncro_order_id', 'rj.lasyncro_order_id')
      .leftJoin('refund_executions as re', 're.lasyncro_refund_execution_id', 'rj.lasyncro_refund_execution_id')
      .where('rj.shop_id', shopId)
      .where('rj.return_job_id', returnJobId)
      .select(
        'rj.return_job_id',
        'rj.lasyncro_refund_execution_id',
        'rj.origin',
        'rj.status',
        'rj.undelivered_reason',
        'rj.owner_decision',
        'rj.notes',
        'rj.claimed_by',
        'rj.claimed_at',
        'rj.created_at',
        'eoim.external_order_id',
        're.total_refund_amount',
        're.executed_at as refund_executed_at',
      )
      .first();

    if (!job) return null;

    const lines = await trx('refund_execution_line_items as reli')
      .join('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oru.lasyncro_variant_id')
      .where('reli.lasyncro_refund_execution_id', job.lasyncro_refund_execution_id ?? null)
      .select(
        'reli.lasyncro_refund_line_item_id',
        'reli.refunded_quantity',
        'reli.item_condition',
        'reli.quantity_received',
        'reli.processed_at',
        'v.title as variant_title',
        'v.sku',
      );

    return { ...job, lines };
  });
}

// ─── List Items Awaiting Owner Decision (web) ─────────────────────────────────
export interface ReturnDecisionLine {
  id: string; // lasyncro_refund_line_item_id
  variant_title: string | null;
  sku: string | null;
  quantity: number | null;
  item_condition: 'damaged' | 'unsellable';
  condition_notes: string | null;
  owner_decision: OwnerDecision | null;
  decision_notes: string | null;
  decided_at: string | null;
}

export interface ReturnDecisionGroup {
  return_job_id: string;
  external_order_id: string | null;
  created_at: string;
  total_refund_amount: number;
  lines: ReturnDecisionLine[];
}

// Order-level groups, one per awaiting_decision job — replaces the old
// flat per-line list. A job stays awaiting_decision until every
// damaged/unsellable line has a decision (see setLineOwnerDecision),
// so this returns ALL such lines per job, decided or not, so the modal
// can show mixed state correctly rather than only ever showing pending
// lines and hiding ones already resolved on a still-open job.
export async function listItemsAwaitingDecision(shopId: number): Promise<ReturnDecisionGroup[]> {
  return withTenant(shopId, async (trx) => {
    const rows = await trx('return_jobs as rj')
      .join('external_order_identity_map as eoim', 'eoim.lasyncro_order_id', 'rj.lasyncro_order_id')
      .join('refund_executions as re', 're.lasyncro_refund_execution_id', 'rj.lasyncro_refund_execution_id')
      .join('refund_execution_line_items as reli', 'reli.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
      .join('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oru.lasyncro_variant_id')
      .where('rj.shop_id', shopId)
      .where('rj.status', 'awaiting_decision')
      .where('rj.origin', 'customer_return')
      .whereIn('reli.item_condition', ['damaged', 'unsellable'])
      .select(
        'rj.return_job_id',
        'rj.created_at',
        'eoim.external_order_id',
        're.total_refund_amount',
        'reli.lasyncro_refund_line_item_id as line_id',
        'reli.quantity_received',
        'reli.item_condition',
        'reli.condition_notes',
        'reli.owner_decision',
        'reli.decision_notes',
        'reli.decision_at',
        'v.title as variant_title',
        'v.sku',
      )
      .orderBy('rj.created_at', 'asc');

    const groups = new Map<string, ReturnDecisionGroup>();
    for (const row of rows) {
      if (!groups.has(row.return_job_id)) {
        groups.set(row.return_job_id, {
          return_job_id: row.return_job_id,
          external_order_id: row.external_order_id,
          created_at: row.created_at,
          total_refund_amount: Number(row.total_refund_amount ?? 0),
          lines: [],
        });
      }
      groups.get(row.return_job_id)!.lines.push({
        id: row.line_id,
        variant_title: row.variant_title,
        sku: row.sku,
        quantity: row.quantity_received,
        item_condition: row.item_condition,
        condition_notes: row.condition_notes,
        owner_decision: row.owner_decision,
        decision_notes: row.decision_notes,
        decided_at: row.decision_at,
      });
    }
    return Array.from(groups.values());
  });
}

// ─── Claim: Return Job (WEB-RETURN-01) ────────────────────────────────────────
export async function claimReturnJob(
  input: ClaimReturnJobInput
): Promise<void> {
  const { shopId, returnJobId, operatorId } = input;

  return withTenant(shopId, async (trx) => {
    const job = await trx('return_jobs')
      .where({ return_job_id: returnJobId, shop_id: shopId })
      .select('status', 'claimed_by')
      .first();

    if (!job) throw new Error(`[RETURN_CLAIM] Job not found: ${returnJobId}`);

    // Allow operator to re-claim their own in-progress job (e.g. after navigating back)
    if (job.status === 'in_progress' && job.claimed_by === operatorId) return;

    if (job.status !== 'pending') {
      throw new Error(`[RETURN_CLAIM] Job not claimable: ${job.status}`);
    }
    if (job.claimed_by !== null) {
      throw new Error('[RETURN_CLAIM] Job already claimed');
    }

    const now = new Date();
    await trx('return_jobs')
      .where({ return_job_id: returnJobId })
      .update({
        status: 'in_progress',
        claimed_by: operatorId,
        claimed_at: now,
        updated_at: now,
      });

    console.info('[RETURN_JOB_CLAIMED]', { returnJobId, operatorId, shopId });

    await writeAuditLog(trx as Knex.Transaction, {
      shopId,
      operatorId,
      actionType: 'return_job_claim',
      entityType: 'return_job',
      entityId: returnJobId,
      metadata: {},
    });
  });
}

/**
 * RESOLVE-OR-CREATE-OR-CLAIM (scan intake)
 * ------------------------------------------
 * Unifies three cases behind one scan action, matching the pack free-scan
 * UX: scan → session pops open ready to work, no separate claim step.
 *
 * 1. No return_job exists for this order → create one directly claimed
 *    by the scanning operator. lasyncro_refund_execution_id is null —
 *    this may predate any Shopify refund entirely (Type B intake).
 * 2. A pending (unclaimed) job exists → claim it for this operator.
 * 3. A job already in_progress/awaiting_decision exists → return as-is;
 *    claimedByOther flags if a different operator holds it, so the UI
 *    can warn rather than silently reassign.
 */
export async function resolveOrCreateReturnJobForScan(
  shopId: number,
  lasyncroOrderId: string,
  operatorId: number
): Promise<ScanIntakeResult> {
  return withTenant(shopId, async (trx) => {
    const existing = await trx('return_jobs')
      .where({ shop_id: shopId, lasyncro_order_id: lasyncroOrderId })
      .whereNotIn('status', ['complete'])
      .orderBy('created_at', 'desc')
      .first();

    const now = new Date();

    if (!existing) {
      const [job] = await trx('return_jobs')
        .insert({
          shop_id: shopId,
          origin: 'customer_return',
          lasyncro_refund_execution_id: null,
          lasyncro_order_id: lasyncroOrderId,
          status: 'in_progress',
          claimed_by: operatorId,
          claimed_at: now,
          source: 'scan_intake',
        })
        .returning('return_job_id');

      const returnJobId = job.return_job_id ?? job;

      console.info('[RETURN_JOB_CREATED_FROM_SCAN]', { returnJobId, shopId, lasyncroOrderId, operatorId });

      await writeAuditLog(trx as Knex.Transaction, {
        shopId,
        operatorId,
        actionType: 'return_job_create',
        entityType: 'return_job',
        entityId: returnJobId,
        metadata: { source: 'scan_intake', lasyncro_order_id: lasyncroOrderId },
      });

      return { returnJobId, status: 'in_progress', isNew: true, claimedByOther: false };
    }

    if (existing.status === 'pending') {
      await trx('return_jobs')
        .where({ return_job_id: existing.return_job_id })
        .update({ status: 'in_progress', claimed_by: operatorId, claimed_at: now, updated_at: now });

      await writeAuditLog(trx as Knex.Transaction, {
        shopId,
        operatorId,
        actionType: 'return_job_claim',
        entityType: 'return_job',
        entityId: existing.return_job_id,
        metadata: { via: 'scan_intake' },
      });

      return { returnJobId: existing.return_job_id, status: 'in_progress', isNew: false, claimedByOther: false };
    }

    return {
      returnJobId: existing.return_job_id,
      status: existing.status,
      isNew: false,
      claimedByOther: existing.claimed_by !== null && existing.claimed_by !== operatorId,
    };
  });
}

export async function createManualReturnLine(
  input: CreateManualReturnLineInput
): Promise<string> {
  const { shopId, returnJobId, scannedValue, quantityReceived, itemCondition, conditionNotes, operatorId } = input;
  return withTenant(shopId, async (trx) => {
    const resolved = await resolveBarcode(trx, shopId, scannedValue);
    if (!resolved) throw new Error(`[RETURN_LINE_MANUAL] Barcode not recognised: ${scannedValue}`);

    // Reuse order_revenue_units if this variant/order combo already has one
    // (it usually will — the order was fulfilled through us); otherwise this
    // is an edge case needing its own resolution, flagged not solved here.
    const job = await trx('return_jobs').where({ return_job_id: returnJobId, shop_id: shopId }).first();
    if (!job) throw new Error(`[RETURN_LINE_MANUAL] Return job not found: ${returnJobId}`);
    if (!['pending', 'in_progress'].includes(job.status)) {
      throw new Error(`[RETURN_LINE_MANUAL] Job not processable: ${job.status}`);
    }
    
    const revenueUnit = await trx('order_revenue_units')
      .where({ lasyncro_order_id: job.lasyncro_order_id, lasyncro_variant_id: resolved.lasyncro_variant_id })
      .select('lasyncro_revenue_unit_id')
      .first();
    if (!revenueUnit) throw new Error(`[RETURN_LINE_MANUAL] No matching order line for this variant — scan the order barcode first`);

    const [line] = await trx('refund_execution_line_items')
      .insert({
        lasyncro_refund_line_item_id: trx.raw('gen_random_uuid()'),
        lasyncro_refund_execution_id: null,
        lasyncro_revenue_unit_id: revenueUnit.lasyncro_revenue_unit_id,
        return_job_id: returnJobId,
        refunded_quantity: quantityReceived,
        quantity_received: quantityReceived,
        item_condition: itemCondition,
        condition_notes: conditionNotes ?? null,
        processed_by: operatorId,
        processed_at: new Date(),
        source: 'scan_intake_manual',
      })
      .returning('lasyncro_refund_line_item_id');

    console.info('[RETURN_LINE_MANUAL_CREATED]', { returnJobId, variantId: resolved.lasyncro_variant_id, shopId });

    await applyReturnLineCascade(trx, {
      shopId,
      returnJobId,
      lasyncroVariantId: resolved.lasyncro_variant_id,
      quantityReceived,
      itemCondition,
    });

    return line.lasyncro_refund_line_item_id;
  });
}