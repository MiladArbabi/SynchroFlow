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

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReturnJobOrigin = 'customer_return' | 'undelivered_return';
export type UndeliveredReason = 'wrong_address' | 'not_claimed' | 'customs' | 'carrier_error' | 'other';
export type OwnerDecision = 'reship' | 'contact_customer' | 'initiate_refund' | 'write_off';
export type ItemCondition = 'resellable' | 'repackable' | 'damaged' | 'unsellable';

export interface CreateCustomerReturnJobInput {
  shopId: number;
  lasyncroRefundExecutionId: string;
  lasyncroOrderId: string;
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
}

export interface SetOwnerDecisionInput {
  shopId: number;
  returnJobId: string;
  decision: OwnerDecision;
  decisionNotes?: string;
  decidedBy: number;
}

// ─── Create: Customer Return ──────────────────────────────────────────────────

export async function createCustomerReturnJob(
  input: CreateCustomerReturnJobInput
): Promise<string> {
  const { shopId, lasyncroRefundExecutionId, lasyncroOrderId, operatorId, notes } = input;

  return withTenant(shopId, async (trx) => {
    // Verify refund execution exists and belongs to this shop
    const refund = await trx('refund_executions as re')
      .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
      .where('re.lasyncro_refund_execution_id', lasyncroRefundExecutionId)
      .where('o.shop_id', shopId)
      .select('re.lasyncro_refund_execution_id')
      .first();

    if (!refund) throw new Error(`[RETURN_JOB_CREATE] Refund execution not found: ${lasyncroRefundExecutionId}`);

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

    if (itemCondition === 'resellable') {
      // Auto-create stow task — inventory restored when stow completes
      await createStowTask(trx as Knex.Transaction, {
        shopId,
        lasyncroVariantId: line.lasyncro_variant_id,
        quantity: quantityReceived,
        trigger: 'inbound_stock',
      });
      console.info('[RETURN_LINE_RESELLABLE]', { returnJobId, variantId: line.lasyncro_variant_id, qty: quantityReceived });
    }

    if (itemCondition === 'repackable') {
      // Problem Center task — repackaging required before restow
      // Uses existing httpCreateProblemTask pattern directly on DB
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
        lasyncro_variant_id: line.lasyncro_variant_id,
        quantity: quantityReceived,
        exception_type: 'repackaging_required',
        problem_bin_location: problemBin,
        notes: probLabel,
      });
      console.info('[RETURN_LINE_REPACKABLE]', { returnJobId, variantId: line.lasyncro_variant_id, probLabel });
    }

    if (itemCondition === 'damaged' || itemCondition === 'unsellable') {
      // Mark job as awaiting owner decision
      await trx('return_jobs')
        .where({ return_job_id: returnJobId })
        .update({ status: 'awaiting_decision', updated_at: now });
      console.info('[RETURN_LINE_FLAGGED]', { returnJobId, itemCondition, variantId: line.lasyncro_variant_id });
      // Alert fires via separate alert worker — job status change is the trigger signal
    }

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
  const { shopId, returnJobId, operatorId } = input;

  await withTenant(shopId, async (trx) => {
    const job = await trx('return_jobs')
      .where({ return_job_id: returnJobId, shop_id: shopId })
      .select('status')
      .first();

    if (!job) throw new Error(`[RETURN_JOB_COMPLETE] Job not found: ${returnJobId}`);
    // Allow complete only when no lines are awaiting decision
    if (job.status === 'awaiting_decision') {
      throw new Error(`[RETURN_JOB_COMPLETE] Job has items awaiting owner decision — cannot complete`);
    }

    const now = new Date();
    await trx('return_jobs')
      .where({ return_job_id: returnJobId })
      .update({ status: 'complete', completed_at: now, updated_at: now });

    console.info('[RETURN_JOB_COMPLETED]', { returnJobId, shopId, operatorId });

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

// ─── List Items Awaiting Owner Decision (web) ─────────────────────────────────

export async function listItemsAwaitingDecision(shopId: number): Promise<unknown[]> {
  return withTenant(shopId, async (trx) => {
    return trx('return_jobs as rj')
      .leftJoin('orders as o', 'o.lasyncro_order_id', 'rj.lasyncro_order_id')
      .leftJoin('external_order_identity_map as eoim', 'eoim.lasyncro_order_id', 'rj.lasyncro_order_id')
      .leftJoin('refund_executions as re', 're.lasyncro_refund_execution_id', 'rj.lasyncro_refund_execution_id')
      .leftJoin('refund_execution_line_items as reli', 'reli.lasyncro_refund_execution_id', 're.lasyncro_refund_execution_id')
      .leftJoin('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'reli.lasyncro_revenue_unit_id')
      .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oru.lasyncro_variant_id')
      .where('rj.shop_id', shopId)
      .where('rj.status', 'awaiting_decision')
      .select(
        'rj.return_job_id',
        'rj.origin',
        'rj.undelivered_reason',
        'rj.created_at',
        'eoim.external_order_id',
        'reli.lasyncro_refund_line_item_id',
        'reli.item_condition',
        'reli.quantity_received',
        'reli.condition_notes',
        'v.title as variant_title',
        'v.sku',
        're.total_refund_amount',
      )
      .orderBy('rj.created_at', 'asc');
  });
}