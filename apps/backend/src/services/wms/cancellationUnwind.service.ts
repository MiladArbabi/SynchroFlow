// apps/backend/src/services/wms/cancellationUnwind.service.ts

/**
 * CANCELLATION PHYSICAL UNWIND (INV-BLOCK-10b)
 * -------------------------------------------------------------------
 * orders.cancelled.ts handles the commercial side only. This service
 * handles the physical side: reservations held for an order that will
 * never ship, and units already picked into a tote.
 *
 * STAGE MATRIX (per line item, from order_line_item_warehouse_status):
 *   no row / awaiting_pick  → allocations released
 *   picking                 → unscanned allocations released; scanned
 *                             allocations RETAINED, problem task raised
 *   picked/packing/packed   → allocations RETAINED, problem task raised
 *   shipped                 → skipped, logged (that is a return, not a
 *                             cancellation — must not abort the commercial
 *                             cancellation, so no throw)
 *
 * WHY DELETE, NOT FLAG: pick_reservation_allocations has no status column
 * and CHECK (quantity > 0), so a row cannot be zeroed or marked. Deletion
 * is the only available mechanism. Picked allocations are retained because
 * pick_scan_log.reservation_allocation_id references them with NO FK, and
 * wms.controller.ts:2152 hard-requires the allocation for allocation-backed
 * picking — deleting one orphans live reads, not just history.
 *
 * COMPLETION GUARDS NEED NO CHANGE: pickScan.service.ts:412-439 and
 * wms.controller.ts:604 compare allocation count against DISTINCT confirmed
 * scans. Deleting unscanned allocations moves both sides together; retained
 * allocations already have a scan and self-satisfy.
 *
 * RESERVATION ACCOUNTING.
 * Unscanned allocations must reverse the reservation_hold written at batch
 * release. Cancellation therefore writes reservation_release movements and
 * restores inventory_truth.available_quantity while reducing
 * reserved_quantity.
 *
 * Already-picked stock is different: no inventory movement is written for
 * the picked unit here. It remains physically out of the bin and is routed
 * through Problem Center; inventory recovery occurs only on supervisor
 * resolution (re_stow → stow task).
 *
 * NOT ROUTED THROUGH pick_exceptions: httpReportPickException throws
 * ALLOCATION_PICK_EXCEPTION_NOT_READY for any allocation-backed line
 * (wms.controller.ts:1977-1987), which is every released line. The problem
 * task is written directly, as the returns writers do for return_shortfall.
 */
import { Knex } from 'knex';
import { randomUUID } from 'crypto';

const RETAIN_STATUSES = ['picking', 'picked', 'packing', 'packed'];

/**
 * GH-1145 R0-1 LOCK ORDER — shared with batchCancellation.service.ts:
 *   orders → pick_batches → pick_batch_orders → order_line_item_warehouse_status
 *   → pick_reservation_allocations → inventory_truth (variant, location order)
 *
 * Every allocation this service releases is read FOR UPDATE while the owning
 * batch is locked, so a concurrent batch cancellation either commits first
 * (the allocation is gone before it is read) or waits until this unwind
 * commits (and then sees only what is still owned). Shopify fulfillment takes
 * the same line warehouse-status lock before touching allocations.
 */
type LockedBatchScope = {
  memberBatchId: string | null;
};

async function lockBatchScope(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroOrderId: string
): Promise<LockedBatchScope> {
  // Release takes this same anchor before creating membership or allocations.
  await trx('orders')
    .where({ shop_id: shopId, lasyncro_order_id: lasyncroOrderId })
    .forUpdate()
    .first('lasyncro_order_id');

  const observedMembership = await trx('pick_batch_orders')
    .where({ shop_id: shopId, lasyncro_order_id: lasyncroOrderId })
    .first('pick_batch_id');
  const observedAllocationBatches = await trx('pick_reservation_allocations')
    .where({ shop_id: shopId, lasyncro_order_id: lasyncroOrderId })
    .distinct('pick_batch_id');
  const batchIds = [
    ...new Set<string>([
      ...(observedMembership ? [String(observedMembership.pick_batch_id)] : []),
      ...observedAllocationBatches.map((row: { pick_batch_id: string }) =>
        String(row.pick_batch_id)
      ),
    ]),
  ].sort();

  for (const batchId of batchIds) {
    await trx('pick_batches')
      .where({ shop_id: shopId, pick_batch_id: batchId })
      .forUpdate()
      .first('pick_batch_id');
  }

  // Re-read membership while both lifecycle anchors are held.
  const membership = await trx('pick_batch_orders')
    .where({ shop_id: shopId, lasyncro_order_id: lasyncroOrderId })
    .forUpdate()
    .first('pick_batch_id');
  return { memberBatchId: membership ? String(membership.pick_batch_id) : null };
}

export async function unwindCancelledOrder(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroOrderId: string
): Promise<void> {
  // 1-2. Order anchor, batch lock(s), then current membership.
  const scope = await lockBatchScope(trx, shopId, lasyncroOrderId);

  await trx('order_warehouse_status')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .forUpdate()
    .first('lasyncro_order_id');

  const orderLines = await trx('order_line_items')
    .where('lasyncro_order_id', lasyncroOrderId)
    .orderBy('lasyncro_line_item_id', 'asc')
    .select(
      'lasyncro_line_item_id',
      'lasyncro_variant_id'
    );

  if (orderLines.length === 0) {
    await detachCancelledOrderFromBatch(trx, shopId, lasyncroOrderId, scope.memberBatchId);
    console.info('[CANCEL_UNWIND_NO_LINES]', { shopId, lasyncroOrderId });
    return;
  }

  // 3. Line warehouse-status locks, before allocations / inventory truth.
  const lockedLineStates = await trx('order_line_item_warehouse_status')
    .where({ shop_id: shopId })
    .whereIn(
      'lasyncro_line_item_id',
      orderLines.map((line: any) => line.lasyncro_line_item_id)
    )
    .orderBy('lasyncro_line_item_id', 'asc')
    .select('lasyncro_line_item_id', 'status')
    .forUpdate();

  const statusByLine = new Map<string, string>(
    lockedLineStates.map((row: { lasyncro_line_item_id: string; status: string }) => [
      String(row.lasyncro_line_item_id),
      String(row.status),
    ])
  );

  const lines = orderLines.map((line: any) => ({
    lasyncro_line_item_id: String(line.lasyncro_line_item_id),
    lasyncro_variant_id: line.lasyncro_variant_id,
    warehouse_status: statusByLine.get(String(line.lasyncro_line_item_id)) ?? null,
  }));

  /**
   * REPLAY GUARD. Cancellation webhooks retry, and orders/cancelled is
   * replayable from domain_events. Keyed on the terminal state this
   * service itself writes, so it needs no extra column or lookup table.
   */
  const alreadyUnwound = lines.every(
    (l) => l.warehouse_status === 'cancelled'
  );

  if (alreadyUnwound) {
    await detachCancelledOrderFromBatch(trx, shopId, lasyncroOrderId, scope.memberBatchId);
    console.info('[CANCEL_UNWIND_ALREADY_APPLIED]', { shopId, lasyncroOrderId });
    return;
  }

  const unwindLineIds = lines
    .filter((line) => line.warehouse_status !== 'shipped')
    .map((line) => line.lasyncro_line_item_id);

  // 4. Current ownership, locked; scanned state derived from the locked rows.
  const lockedAllocations = unwindLineIds.length === 0
    ? []
    : await trx('pick_reservation_allocations')
      .where({ shop_id: shopId })
      .whereIn('lasyncro_line_item_id', unwindLineIds)
      .orderBy('allocation_id', 'asc')
      .select(
        'allocation_id',
        'pick_batch_id',
        'lasyncro_line_item_id',
        'lasyncro_variant_id',
        'location_code',
        'quantity'
      )
      .forUpdate();

  const scannedRows = unwindLineIds.length === 0
    ? []
    : await trx('pick_scan_log')
      .where({
        shop_id: shopId,
        status: 'confirmed',
      })
      .whereIn('lasyncro_line_item_id', unwindLineIds)
      .whereNotNull('reservation_allocation_id')
      .pluck('reservation_allocation_id');

  const scanned = new Set<string>(
    scannedRows.map((id: unknown) => String(id))
  );

  // 5. Release still-owned unscanned allocations, variant + location order.
  const releasable = lockedAllocations
    .filter((a: any) => !scanned.has(String(a.allocation_id)))
    .sort((a: any, b: any) => {
      const left = `${a.lasyncro_variant_id}\u0000${a.location_code}\u0000${a.allocation_id}`;
      const right = `${b.lasyncro_variant_id}\u0000${b.location_code}\u0000${b.allocation_id}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });

  for (const allocation of releasable) {
    const releasedAt = new Date();

    const insertedRelease = await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: randomUUID(),
        lasyncro_variant_id: allocation.lasyncro_variant_id,
        shop_id: shopId,
        movement_type: 'reservation_release',
        quantity_delta: -Number(allocation.quantity),
        location_code: allocation.location_code,
        reference_type: 'pick_reservation_allocation',
        reference_id: allocation.allocation_id,
        platform: 'wms',
        occurred_at: releasedAt,
        operator_id: null,
        triggered_by: 'order_cancelled',
      })
      .onConflict([
        'shop_id',
        'reference_type',
        'reference_id',
        'lasyncro_variant_id',
        'location_code',
        'movement_type',
      ])
      .ignore()
      .returning('lasyncro_inventory_movement_id');

    if (insertedRelease.length === 1) {
      const releasedQuantity = Number(allocation.quantity);

      const updatedTruthRows = await trx('inventory_truth')
        .where({
          shop_id: shopId,
          lasyncro_variant_id: allocation.lasyncro_variant_id,
          location_code: allocation.location_code,
        })
        .where('reserved_quantity', '>=', releasedQuantity)
        .update({
          reserved_quantity: trx.raw(
            'reserved_quantity - ?',
            [releasedQuantity]
          ),
          available_quantity: trx.raw(
            'available_quantity + ?',
            [releasedQuantity]
          ),
          last_evaluated_at: releasedAt,
          updated_at: releasedAt,
        });

      if (updatedTruthRows !== 1) {
        throw new Error(
          `[CANCEL_UNWIND] INVENTORY_TRUTH_RESERVATION_RELEASE_FAILED allocation=${allocation.allocation_id}`
        );
      }
    }

    await trx('pick_reservation_allocations')
      .where({
        shop_id: shopId,
        allocation_id: allocation.allocation_id,
      })
      .delete();
  }

  // 6. Per-line retention / Problem Center / status, on already-locked rows.
  for (const line of lines) {
    const status = line.warehouse_status;

    if (status === 'shipped') {
      console.warn('[CANCEL_UNWIND_SHIPPED_SKIPPED]', {
        shopId,
        lasyncroOrderId,
        lasyncroLineItemId: line.lasyncro_line_item_id,
      });
      continue;
    }

    const allocations = lockedAllocations.filter(
      (a: any) => String(a.lasyncro_line_item_id) === line.lasyncro_line_item_id
    );

    if (allocations.length === 0) {
      await markLineCancelled(trx, shopId, line.lasyncro_line_item_id);
      continue;
    }

    const released = allocations.filter(
      (a: any) => !scanned.has(String(a.allocation_id))
    );

    if (released.length > 0) {
      console.info('[CANCEL_UNWIND_ALLOCATIONS_RELEASED]', {
        shopId,
        lasyncroOrderId,
        lasyncroLineItemId: line.lasyncro_line_item_id,
        released: released.length,
        releasedQuantity: released.reduce(
          (sum: number, allocation: any) =>
            sum + Number(allocation.quantity),
          0
        ),
      });
    }

    const retainedQty = allocations
      .filter((a: any) => scanned.has(String(a.allocation_id)))
      .reduce((sum: number, a: any) => sum + Number(a.quantity), 0);

    if (retainedQty > 0 && (status === null || RETAIN_STATUSES.includes(status))) {
      await raiseProblemTask(trx, {
        shopId,
        lasyncroOrderId,
        lasyncroVariantId: line.lasyncro_variant_id,
        quantity: retainedQty,
      });
    }

    await markLineCancelled(trx, shopId, line.lasyncro_line_item_id);
  }

  await detachCancelledOrderFromBatch(trx, shopId, lasyncroOrderId, scope.memberBatchId);
}

/**
 * Caller holds the batch row and membership row locks (lockBatchScope), so
 * no lock is taken here in an order that could invert the shared lock order.
 */
async function detachCancelledOrderFromBatch(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroOrderId: string,
  memberBatchId: string | null
): Promise<void> {
  const now = new Date();

  await trx('order_warehouse_status')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .update({
      status: 'cancelled',
      pick_batch_id: null,
      status_updated_at: now,
      updated_at: now,
    });

  if (!memberBatchId) {
    return;
  }

  const batch = await trx('pick_batches')
    .where({
      shop_id: shopId,
      pick_batch_id: memberBatchId,
    })
    .first('status');

  await trx('pick_batch_orders')
    .where({
      shop_id: shopId,
      lasyncro_order_id: lasyncroOrderId,
      pick_batch_id: memberBatchId,
    })
    .delete();

  const remainingOrders = await trx('pick_batch_orders')
    .where({
      shop_id: shopId,
      pick_batch_id: memberBatchId,
    })
    .count<{ count: string }>('* as count')
    .first();

  if (batch && Number(remainingOrders?.count ?? 0) === 0) {
    await trx('pick_batches')
      .where({
        shop_id: shopId,
        pick_batch_id: memberBatchId,
      })
      .update({
        status: 'cancelled',
        updated_at: now,
      });
  }

  console.info('[CANCEL_UNWIND_BATCH_DETACHED]', {
    shopId,
    lasyncroOrderId,
    pickBatchId: memberBatchId,
    remainingOrders: Number(remainingOrders?.count ?? 0),
  });
}

async function markLineCancelled(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroLineItemId: string
): Promise<void> {
  await trx('order_line_item_warehouse_status')
    .where({ shop_id: shopId, lasyncro_line_item_id: lasyncroLineItemId })
    .update({
      status: 'cancelled',
      status_updated_at: new Date(),
      updated_at: new Date(),
    });
}

/**
 * Prob-label sequence pattern copied verbatim from the four existing
 * problem_center_tasks writers (wms.controller.ts:3736, stow.service.ts:487,
 * returnJobs.service.ts:402 and :497). Do not re-invent — the sequence is
 * per-shop and must stay monotonic.
 */
async function raiseProblemTask(
  trx: Knex.Transaction,
  input: {
    shopId: number;
    lasyncroOrderId: string;
    lasyncroVariantId: string;
    quantity: number;
  }
): Promise<void> {
  const { shopId, lasyncroOrderId, lasyncroVariantId, quantity } = input;

  const seqResult = await trx.raw(
    `UPDATE shop_wms_settings
     SET prob_label_sequence = prob_label_sequence + 1, updated_at = NOW()
     WHERE shop_id = ?
     RETURNING prob_label_sequence, problem_bin_location`,
    [shopId]
  );

  const seqRow = seqResult.rows[0];
  if (!seqRow?.problem_bin_location) {
    throw new Error('PROBLEM_BIN_NOT_CONFIGURED');
  }

  const probLabel = `PROB-${shopId}-${String(seqRow.prob_label_sequence).padStart(4, '0')}`;

  await trx('problem_center_tasks').insert({
    shop_id: shopId,
    status: 'open',
    source: 'pick',
    // problem_center_tasks has no order column; the returns writers store
    // their parent job id here for the same reason (returnJobs.service.ts:419).
    source_exception_id: lasyncroOrderId,
    lasyncro_variant_id: lasyncroVariantId,
    quantity,
    exception_type: 'order_cancelled',
    problem_bin_location: seqRow.problem_bin_location,
    notes: probLabel,
  });

  console.info('[CANCEL_UNWIND_PROBLEM_TASK_RAISED]', {
    shopId,
    lasyncroOrderId,
    lasyncroVariantId,
    quantity,
    probLabel,
  });
}
