// apps/backend/src/services/wms/receiveJob.service.ts
import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { createStowTask } from './stow.service.js';
import { fireStowTaskAlert, fireReceiveArrivedAlert } from './wmsAlerts.service.js';
import { recomputeSupplierRating, recomputeSupplierDefectRate } from '../suppliers/supplierRating.service.js';
import { suggestStowLocation } from './locationSuggestion.service.js';
import { writeAuditLog } from '../audit/operatorAudit.service.js';
import { batchConfirmUnits } from './inventoryUnit.service.js';
import { evaluateOrderConstraints } from '../constraints/constraintEngine.js';
import { projectOrderConstraints } from '../../projections/orderConstraintProjection.js';

/**
 * RECEIVE JOB SERVICE (FEAT-004)
 * --------------------------------
 * Manages the full inbound receive pipeline:
 *   PO shipped → receive job created → inspection → barcode assignment → stow_ready → closed
 *
 * Key invariants:
 * - One receive job per delivery event (split deliveries = multiple jobs per PO)
 * - quantity_received on purchase_order_line_items written only on job close
 * - stow_tasks created automatically per variant on transition to stow_ready
 * - actual_delivery_date written back to purchase_orders on job close → triggers rating recompute
 * - po_id on stow_tasks is application-enforced (no DB FK — migration ordering constraint)
 */

// ─────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────

export interface CreateReceiveJobInput {
  shopId: number;
  poId: string;
  operatorId?: number;
}

/**
 * Creates a receive job from a shipped PO.
 * Populates receive_job_lines from purchase_order_line_items.
 * Called explicitly via POST /suppliers/purchase-orders/:poId/receive-jobs after PO is advanced to shipped.
 * NOT auto-called by the status transition — owner/admin must trigger receive job creation manually.
 */
export async function createReceiveJob(
  trx: Knex.Transaction,
  input: CreateReceiveJobInput
): Promise<string> {
  const { shopId, poId, operatorId } = input;

  const lineItems = await trx('purchase_order_line_items')
    .where({ po_id: poId, shop_id: shopId });

  if (lineItems.length === 0) {
    throw new Error(`[RECEIVE_JOB_CREATE] No line items found for PO ${poId}`);
  }

  const totalUnits = lineItems.reduce((sum: number, li: any) => sum + li.quantity_ordered, 0);

  const [receiveJobId] = await trx('receive_jobs')
    .insert({
      shop_id: shopId,
      po_id: poId,
      status: 'pending',
      assigned_operator_id: operatorId ?? null,
      total_variants: lineItems.length,
      total_units: totalUnits,
    })
    .returning('receive_job_id');

  const jobId = receiveJobId?.receive_job_id ?? receiveJobId;

  // Create one line per variant — with location suggestion (WM-36)
  const jobLines = await Promise.all(
    lineItems.map(async (li: any) => {
      const suggestedLocation = li.lasyncro_variant_id
        ? await suggestStowLocation(trx, { shopId, lasyncroVariantId: li.lasyncro_variant_id })
        : null;

      return {
        shop_id: shopId,
        receive_job_id: jobId,
        po_line_item_id: li.id,
        lasyncro_variant_id: li.lasyncro_variant_id,
        quantity_expected: li.quantity_ordered,
        suggested_location_code: suggestedLocation ?? null,
      };
    })
  );

  await trx('receive_job_lines').insert(jobLines);

  console.info('[RECEIVE_JOB_CREATED]', { shopId, poId, jobId, totalVariants: lineItems.length, totalUnits });
  return jobId;
}

// ─────────────────────────────────────────
// INSPECT — record accepted/rejected per line
// ─────────────────────────────────────────

export interface InspectLineInput {
  shopId: number;
  receiveJobId: string;
  lasyncroVariantId: string | null;
  receiveJobLineId?: string | null;
  quantityAccepted: number;
  quantityRejected: number;
  inspectedBy: number;
}

/**
 * Records inspection result for a single variant batch.
 * Marks the line as inspection_complete.
 * Updates running counters on the parent receive_job.
 */
export async function inspectReceiveJobLine(
  trx: Knex.Transaction,
  input: InspectLineInput
): Promise<void> {

  const { shopId, receiveJobId, lasyncroVariantId, receiveJobLineId, quantityAccepted, quantityRejected, inspectedBy } = input;
  const query = trx('receive_job_lines')
    .where({ receive_job_id: receiveJobId, shop_id: shopId });
  if (receiveJobLineId) {
    query.where({ receive_job_line_id: receiveJobLineId });
  } else if (lasyncroVariantId) {
    query.where({ lasyncro_variant_id: lasyncroVariantId });
  } else {
    throw new Error('[RECEIVE_INSPECT] Either lasyncroVariantId or receiveJobLineId required');
  }
  const line = await query.first();
  if (!line) throw new Error(`[RECEIVE_INSPECT] Line not found on job ${receiveJobId}`);
  if (line.inspection_complete) throw new Error(`[RECEIVE_INSPECT] Line already inspected on job ${receiveJobId}`);

  await trx('receive_job_lines')
    .where({ receive_job_line_id: line.receive_job_line_id })
    .update({
      quantity_accepted: quantityAccepted,
      quantity_rejected: quantityRejected,
      inspection_complete: true,
      updated_at: new Date(),
    });

  // Update parent job counters
  await trx('receive_jobs')
    .where({ receive_job_id: receiveJobId })
    .update({
      units_inspected: trx.raw('units_inspected + ?', [quantityAccepted + quantityRejected]),
      units_accepted: trx.raw('units_accepted + ?', [quantityAccepted]),
      units_rejected: trx.raw('units_rejected + ?', [quantityRejected]),
      updated_at: new Date(),
    });

  console.info('[RECEIVE_LINE_INSPECTED]', { receiveJobId, lasyncroVariantId, quantityAccepted, quantityRejected });

  // WM-46 — generate LSU- unit barcodes for all accepted units
  if (quantityAccepted > 0) {
    const variantRow = await trx('variants')
      .where({ lasyncro_variant_id: line.lasyncro_variant_id, shop_id: shopId })
      .select('barcode')
      .first();

    await batchConfirmUnits(trx, {
      shopId,
      receiveJobLineId: line.receive_job_line_id,
      lasyncroVariantId: line.lasyncro_variant_id,
      quantity: quantityAccepted,
      shopifyBarcode: variantRow?.barcode ?? null,
      createdBy: inspectedBy,
    });
  }

  // Auto-advance job status when all lines are inspection_complete
  const allLines = await trx('receive_job_lines')
    .where({ receive_job_id: receiveJobId, shop_id: shopId })
    .select('inspection_complete');
  const allInspected = allLines.every((l: any) => l.inspection_complete);
  if (allInspected) {
    await trx('receive_jobs')
      .where({ receive_job_id: receiveJobId })
      .update({ status: 'inspection', updated_at: new Date() });
    console.info('[RECEIVE_JOB_ALL_LINES_INSPECTED]', { receiveJobId });
  }

  await writeAuditLog(trx, {
    shopId,
    operatorId: inspectedBy,
    actionType: 'receive_inspect',
    entityType: 'receive_job',
    entityId: receiveJobId,
    metadata: { lasyncro_variant_id: lasyncroVariantId, quantity_accepted: quantityAccepted, quantity_rejected: quantityRejected },
  });
}

// ─────────────────────────────────────────
// CLOSE — write quantities + create stow tasks
// ─────────────────────────────────────────

export interface CloseReceiveJobInput {
  shopId: number;
  receiveJobId: string;
  actualDeliveryDate?: string;
  closedBy: number;
}

/**
 * REVALIDATE ORDERS AFFECTED BY RECEIVED STOCK (DF-04, 2026-07-01)
 * -------------------------------------------------------------------
 * Closes a confirmed gap: receiving stock updates inventory_truth
 * correctly, but nothing previously re-checked whether orders that
 * were blocked waiting on that exact stock could now unblock. Without
 * this, order_constraints stayed stale until an unrelated order event
 * happened to touch the same order, or an operator manually re-clicked
 * the order's "Acknowledge Stock Issue" action.
 *
 * Scope is intentionally narrow: only orders with an ACTIVE inventory
 * constraint whose target_id is one of the variants just received.
 * Not a shop-wide sweep — see demand-velocity-reorder-playbook.md §6.
 *
 * Reuses the exact evaluate → persist pair projection.engine.ts already
 * uses for the normal domain-event path (evaluateOrderConstraints +
 * projectOrderConstraints) — no new constraint-writing logic, no risk
 * of colliding with orderConstraintProjection.ts's multi-writer guard.
 *
 * order_constraints has no shop_id column (RLS-only tenant isolation
 * via a join to orders — see migration 0070) — joined explicitly here
 * rather than relying on RLS alone for a cross-order lookup.
 */
async function revalidateOrdersForReceivedVariants(
  trx: Knex.Transaction,
  shopId: number,
  receivedVariantIds: string[]
): Promise<void> {
  if (receivedVariantIds.length === 0) return;

  const affected = await trx('order_constraints as oc')
    .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .where('oc.constraint_type', 'inventory')
    .where('oc.is_active', true)
    .whereIn('oc.target_id', receivedVariantIds)
    .distinct('oc.lasyncro_order_id')
    .select('oc.lasyncro_order_id');

  if (affected.length === 0) {
    console.info('[DF04_NO_AFFECTED_ORDERS]', { shopId, receivedVariantIds });
    return;
  }

  console.info('[DF04_REVALIDATING_ORDERS]', {
    shopId,
    receivedVariantIds,
    affectedOrderCount: affected.length,
  });

  for (const row of affected) {
    const orderId = row.lasyncro_order_id;

    const orderRow = await trx('orders')
      .where({ lasyncro_order_id: orderId })
      .select('aggregate_version')
      .first();

    if (!orderRow?.aggregate_version) {
      // Same invariant projection.engine.ts enforces — log and skip
      // rather than throw, so one bad order can't abort the receive close.
      console.error('[DF04_MISSING_AGGREGATE_VERSION]', { orderId, shopId });
      continue;
    }

    try {
      const evaluations = await evaluateOrderConstraints(trx, orderId, shopId);

      /**
       * PROJECTION WRITER BYPASS (DF-04-FIX-01)
       * ----------------------------------------
       * order_constraints is guarded by enforce_projection_writer_order_constraints
       * trigger. This is a legitimate projection write (constraint revalidation
       * after stock receipt) occurring outside the projection engine's own
       * transaction — set the GUC to satisfy the trigger guard, same pattern
       * already used in rebuildInventoryProjectionForVariants.
       * SET LOCAL scopes it to this transaction only.
       */
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      await projectOrderConstraints(
        trx,
        orderId,
        shopId,
        orderRow.aggregate_version,
        new Date(),
        evaluations
      );
      console.info('[DF04_ORDER_REVALIDATED]', { orderId, shopId });
    } catch (err) {
      // Isolate failures per-order — one bad revalidation must not roll
      // back the receive job close itself.
      console.error('[DF04_REVALIDATION_FAILED]', {
        orderId,
        shopId,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Closes a receive job:
 * 1. Validates all lines are inspection_complete
 * 2. Writes quantity_accepted back to purchase_order_line_items.quantity_received
 * 3. Checks if PO is now fully received → advances PO status
 * 4. Creates stow_tasks for all accepted variant groups
 * 5. Writes actual_delivery_date to purchase_orders if provided
 * 6. Resolves wms:receive:arrived alert
 */
export async function closeReceiveJob(
  trx: Knex.Transaction,
  input: CloseReceiveJobInput
): Promise<void> {
  const { shopId, receiveJobId, actualDeliveryDate, closedBy } = input;

  const job = await trx('receive_jobs')
    .where({ receive_job_id: receiveJobId, shop_id: shopId })
    .first();

  if (!job) throw new Error(`[RECEIVE_JOB_CLOSE] Job not found: ${receiveJobId}`);
  if (job.status === 'closed') throw new Error(`[RECEIVE_JOB_CLOSE] Already closed: ${receiveJobId}`);

  const lines = await trx('receive_job_lines')
    .where({ receive_job_id: receiveJobId, shop_id: shopId });

  const incomplete = lines.filter((l: any) => !l.inspection_complete);
  if (incomplete.length > 0) {
    throw new Error(`[RECEIVE_JOB_CLOSE] ${incomplete.length} lines not yet inspected on job ${receiveJobId}`);
  }

  // 1. Write quantity_received back to PO line items
  for (const line of lines) {
    await trx('purchase_order_line_items')
      .where({ id: line.po_line_item_id, shop_id: shopId })
      .update({
        quantity_received: trx.raw('quantity_received + ?', [line.quantity_accepted]),
      });
  }

  // 2. Write actual_delivery_date to PO if provided
  const po = await trx('purchase_orders')
    .where({ id: job.po_id, shop_id: shopId })
    .first();

  if (actualDeliveryDate) {
    await trx('purchase_orders')
      .where({ id: job.po_id, shop_id: shopId })
      .update({ actual_delivery_date: actualDeliveryDate, updated_at: new Date() });
  }

  // 3. Check if PO is now fully received
  const allLineItems = await trx('purchase_order_line_items')
    .where({ po_id: job.po_id, shop_id: shopId });

  const fullyReceived = allLineItems.every(
    (li: any) => li.quantity_received >= li.quantity_ordered
  );
  const hasPartial = allLineItems.some((li: any) => li.quantity_received > 0);

  const newPoStatus = fullyReceived ? 'received' : hasPartial ? 'partially_received' : po.status;
  if (newPoStatus !== po.status) {
    await trx('purchase_orders')
      .where({ id: job.po_id, shop_id: shopId })
      .update({ status: newPoStatus, updated_at: new Date() });
  }

  // 3. Backfill variants.unit_cost from PO line items where cost is unknown (= 0).
  // unit_cost_cents on PO line items is the merchant's authoritative purchase cost.
  // Never overwrite a real cost — only fill the 0-placeholder left by Shopify ingestion.
  for (const line of lines) {
    if (!line.po_line_item_id || line.quantity_accepted <= 0) continue;

    const poLine = await trx('purchase_order_line_items')
      .where({ id: line.po_line_item_id, shop_id: shopId })
      .select('unit_cost_cents', 'lasyncro_variant_id')
      .first();

    if (!poLine?.unit_cost_cents || poLine.unit_cost_cents <= 0) continue;
    if (!poLine.lasyncro_variant_id) continue;

    await trx('variants')
      .where({ lasyncro_variant_id: poLine.lasyncro_variant_id, shop_id: shopId })
      .where('unit_cost', 0) // only fill placeholder — never overwrite real cost
      .update({
        unit_cost: poLine.unit_cost_cents / 100,
        updated_at: new Date(),
      });
  }

  // 3a. Increment supplier total_pos on full receipt — mirrors httpUpdatePoStatus behaviour
  if (fullyReceived) {
    await trx('suppliers')
      .where({ id: po.supplier_id, shop_id: shopId })
      .increment('total_pos', 1);
  }

  // 3b. Recompute supplier rating — on_time_rate, fill_rate, avg_delivery_days
  await recomputeSupplierRating(trx, shopId, po.supplier_id);
  // 3c. Recompute defect_rate from receive_exceptions (defect type only)
  await recomputeSupplierDefectRate(trx, shopId, po.supplier_id);

  /**
   * INVENTORY WRITE ON RECEIVE CLOSE (INV-01)
   * ------------------------------------------
   * Write inbound_purchase movement immediately on receive close.
   * Stock becomes available at WH-{shopId}-ROOT (unlocated).
   * Stow confirm later updates location_code on inventory_truth only.
   *
   * Invariant: available_quantity = on_hand_quantity - reserved_quantity
   * Movement is append-only — never updated after insert.
   *
   * Audit: reference_type='receive_job', reference_id=receiveJobId
   */
  const RECEIVE_NAMESPACE = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  for (const line of lines) {
    if (line.quantity_accepted <= 0) continue;
    if (!line.lasyncro_variant_id) continue; 
    // unlinked line — no inventory write, no barcode, no stow task

    const rootLocation = `WH-${shopId}-ROOT`;
    const movementId = uuidv5(
      `${receiveJobId}:${line.lasyncro_variant_id}:inbound_purchase`,
      RECEIVE_NAMESPACE
    );
    const deviceEventId = uuidv5(
      `${receiveJobId}:${line.lasyncro_variant_id}:device`,
      RECEIVE_NAMESPACE
    );

    await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: movementId,
        lasyncro_variant_id: line.lasyncro_variant_id,
        shop_id: shopId,
        movement_type: 'inbound_purchase',
        quantity_delta: line.quantity_accepted,
        location_code: rootLocation,
        reference_type: 'receive_job',
        reference_id: receiveJobId,
        platform: 'wms',
        occurred_at: new Date(),
        device_event_id: deviceEventId,
        operator_id: closedBy,  // traceability: operator who received stock
        triggered_by: 'receive_job',      // traceability: source of movement
      })
      .onConflict(['device_event_id'])
      .ignore();

    // Upsert inventory_truth — increment on_hand and available at ROOT
    await trx('inventory_truth')
      .insert({
        shop_id: shopId,
        lasyncro_variant_id: line.lasyncro_variant_id,
        location_code: rootLocation,
        on_hand_quantity: line.quantity_accepted,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: line.quantity_accepted,
        sellable_quantity: line.quantity_accepted,
        last_evaluated_at: new Date(),
      })
      .onConflict(['shop_id', 'lasyncro_variant_id', 'location_code'])
      .merge({
        on_hand_quantity: trx.raw('inventory_truth.on_hand_quantity + ?', [line.quantity_accepted]),
        available_quantity: trx.raw('inventory_truth.available_quantity + ?', [line.quantity_accepted]),
        sellable_quantity: trx.raw('inventory_truth.sellable_quantity + ?', [line.quantity_accepted]),
        last_evaluated_at: new Date(),
        updated_at: new Date(),
      });

    /**
     * BARCODE GENERATION ON RECEIVE CLOSE (BAR-01)
     * ----------------------------------------------
     * One barcode per variant — shared across all units of same SKU.
     * barcode_value = SKU if available, else short variant ID.
     * Operator prints and attaches to product packaging before stow.
     */
    const variant = await trx('variants')
      .where({ lasyncro_variant_id: line.lasyncro_variant_id, shop_id: shopId })
      .select('sku')
      .first();

    const barcodeValue = variant?.sku?.trim()
      ? variant.sku.trim()
      : line.lasyncro_variant_id.replace(/-/g, '').slice(0, 12).toUpperCase();

    await trx('barcode_print_jobs')
      .insert({
        shop_id: shopId,
        receive_job_id: receiveJobId,
        lasyncro_variant_id: line.lasyncro_variant_id,
        quantity: line.quantity_accepted,
        barcode_value: barcodeValue,
        status: 'pending',
        created_by: closedBy,
      })
      .onConflict(['shop_id', 'receive_job_id', 'lasyncro_variant_id'])
      .merge({
        quantity: line.quantity_accepted,
        barcode_value: barcodeValue,
        status: 'pending',
        updated_at: new Date(),
      });
  }

  // 4. Create stow tasks for accepted units (quantity > 0 only)
  // Skip unlinked lines — no variant ID means no stow task can be created
  for (const line of lines) {
    if (line.quantity_accepted <= 0) continue;
    if (!line.lasyncro_variant_id) continue;

    const stowTaskId = await createStowTask(trx, {
      shopId,
      lasyncroVariantId: line.lasyncro_variant_id,
      quantity: line.quantity_accepted,
      trigger: 'inbound_stock',
      poId: job.po_id,
      // WM-36: use suggested location from receive_job_lines if available.
      // Operator can still override via PATCH /stow-tasks/:taskId/location.
      locationCode: line.suggested_location_code ?? undefined,
    });

    await fireStowTaskAlert(trx, {
      shopId,
      stowTaskId,
      isActive: true,
      trigger: 'inbound_stock',
    });
  }

  // 5. Close the job
  await trx('receive_jobs')
    .where({ receive_job_id: receiveJobId })
    .update({
      status: 'closed',
      closed_at: new Date(),
      updated_at: new Date(),
    });

  // 6. Resolve wms:receive:arrived alert — no further operator action needed
  const supplier = await trx('suppliers').where({ id: po.supplier_id, shop_id: shopId }).first();
  await fireReceiveArrivedAlert(trx, {
    shopId,
    poId: job.po_id,
    supplierName: supplier?.name ?? 'Unknown supplier',
    isActive: false,
  });

  console.info('[RECEIVE_JOB_CLOSED]', { shopId, receiveJobId, poId: job.po_id, newPoStatus, closedBy });
    await writeAuditLog(trx, {
      shopId,
      operatorId: closedBy,
      actionType: 'receive_close',
      entityType: 'receive_job',
      entityId: receiveJobId,
      metadata: { po_id: job.po_id, po_status: newPoStatus },
    });
  
  console.info('[RECEIVE_JOB_CLOSED]', { shopId, receiveJobId, poId: job.po_id, newPoStatus, closedBy });
    await writeAuditLog(trx, {
      shopId,
      operatorId: closedBy,
      actionType: 'receive_close',
      entityType: 'receive_job',
      entityId: receiveJobId,
      metadata: { po_id: job.po_id, po_status: newPoStatus },
    });

    // DF-04 — revalidate orders that were blocked waiting on the variants
    // just received. Same trx, same atomic scope as the receive close.
    const receivedVariantIds = [
      ...new Set(
        lines
          .filter((l: any) => l.quantity_accepted > 0 && l.lasyncro_variant_id)
          .map((l: any) => l.lasyncro_variant_id as string)
      ),
    ];
    await revalidateOrdersForReceivedVariants(trx, shopId, receivedVariantIds);
}