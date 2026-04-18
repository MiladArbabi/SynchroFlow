// apps/backend/src/services/wms/receiveJob.service.ts
import { Knex } from 'knex';
import { createStowTask } from './stow.service.js';
import { fireStowTaskAlert, fireReceiveArrivedAlert } from './wmsAlerts.service.js';

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
 * Called by PATCH /suppliers/purchase-orders/:poId/status on → shipped.
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

  // Create one line per variant
  await trx('receive_job_lines').insert(
    lineItems.map((li: any) => ({
      shop_id: shopId,
      receive_job_id: jobId,
      po_line_item_id: li.id,
      lasyncro_variant_id: li.lasyncro_variant_id,
      quantity_expected: li.quantity_ordered,
    }))
  );

  console.info('[RECEIVE_JOB_CREATED]', { shopId, poId, jobId, totalVariants: lineItems.length, totalUnits });
  return jobId;
}

// ─────────────────────────────────────────
// INSPECT — record accepted/rejected per line
// ─────────────────────────────────────────

export interface InspectLineInput {
  shopId: number;
  receiveJobId: string;
  lasyncroVariantId: string;
  quantityAccepted: number;
  quantityRejected: number;
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
  const { shopId, receiveJobId, lasyncroVariantId, quantityAccepted, quantityRejected } = input;

  const line = await trx('receive_job_lines')
    .where({ receive_job_id: receiveJobId, lasyncro_variant_id: lasyncroVariantId, shop_id: shopId })
    .first();

  if (!line) throw new Error(`[RECEIVE_INSPECT] Line not found: ${lasyncroVariantId} on job ${receiveJobId}`);
  if (line.inspection_complete) throw new Error(`[RECEIVE_INSPECT] Line already inspected: ${lasyncroVariantId}`);

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

  // 4. Create stow tasks for accepted units (quantity > 0 only)
  for (const line of lines) {
    if (line.quantity_accepted <= 0) continue;

    const stowTaskId = await createStowTask(trx, {
      shopId,
      lasyncroVariantId: line.lasyncro_variant_id,
      quantity: line.quantity_accepted,
      trigger: 'inbound_stock',
      poId: job.po_id,
      // location_code omitted — assigned via PATCH /stow-tasks/:taskId/location (WM-36)
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
}