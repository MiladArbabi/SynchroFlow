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

export async function unwindCancelledOrder(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroOrderId: string
): Promise<void> {
  const lines = await trx('order_line_items as oli')
    .leftJoin('order_line_item_warehouse_status as ws', function () {
      this.on('ws.lasyncro_line_item_id', 'oli.lasyncro_line_item_id')
        .andOn(trx.raw('ws.shop_id = ?', [shopId]));
    })
    .where('oli.lasyncro_order_id', lasyncroOrderId)
    .select(
      'oli.lasyncro_line_item_id',
      'oli.lasyncro_variant_id',
      'ws.status as warehouse_status'
    );

  if (lines.length === 0) {
    await detachCancelledOrderFromBatch(trx, shopId, lasyncroOrderId);
    console.info('[CANCEL_UNWIND_NO_LINES]', { shopId, lasyncroOrderId });
    return;
  }

  /**
   * REPLAY GUARD. Cancellation webhooks retry, and orders/cancelled is
   * replayable from domain_events. Keyed on the terminal state this
   * service itself writes, so it needs no extra column or lookup table.
   */
  const alreadyUnwound = lines.every(
    (l: any) => l.warehouse_status === 'cancelled'
  );

  if (alreadyUnwound) {
    await detachCancelledOrderFromBatch(trx, shopId, lasyncroOrderId);
    console.info('[CANCEL_UNWIND_ALREADY_APPLIED]', { shopId, lasyncroOrderId });
    return;
  }

  for (const line of lines) {
    const status = line.warehouse_status as string | null;

    if (status === 'shipped') {
      console.warn('[CANCEL_UNWIND_SHIPPED_SKIPPED]', {
        shopId,
        lasyncroOrderId,
        lasyncroLineItemId: line.lasyncro_line_item_id,
      });
      continue;
    }

    const allocations = await trx('pick_reservation_allocations')
      .where({
        shop_id: shopId,
        lasyncro_line_item_id: line.lasyncro_line_item_id,
      })
      .select(
        'allocation_id',
        'lasyncro_variant_id',
        'location_code',
        'quantity'
      );

    if (allocations.length === 0) {
      await markLineCancelled(trx, shopId, line.lasyncro_line_item_id);
      continue;
    }

    const scannedRows = await trx('pick_scan_log')
      .where({
        shop_id: shopId,
        lasyncro_line_item_id: line.lasyncro_line_item_id,
        status: 'confirmed',
      })
      .whereNotNull('reservation_allocation_id')
      .pluck('reservation_allocation_id');

    const scanned = new Set<string>(scannedRows);

    const releasable = allocations.filter(
      (a: any) => !scanned.has(a.allocation_id)
    );

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

    if (releasable.length > 0) {
      console.info('[CANCEL_UNWIND_ALLOCATIONS_RELEASED]', {
        shopId,
        lasyncroOrderId,
        lasyncroLineItemId: line.lasyncro_line_item_id,
        released: releasable.length,
        releasedQuantity: releasable.reduce(
          (sum: number, allocation: any) =>
            sum + Number(allocation.quantity),
          0
        ),
      });
    }

    const retainedQty = allocations
      .filter((a: any) => scanned.has(a.allocation_id))
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

  await detachCancelledOrderFromBatch(trx, shopId, lasyncroOrderId);
}

async function detachCancelledOrderFromBatch(
  trx: Knex.Transaction,
  shopId: number,
  lasyncroOrderId: string
): Promise<void> {
  const membership = await trx('pick_batch_orders')
    .where({
      shop_id: shopId,
      lasyncro_order_id: lasyncroOrderId,
    })
    .select('pick_batch_id')
    .forUpdate()
    .first();

  const now = new Date();

  await trx('order_warehouse_status')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .update({
      status: 'cancelled',
      pick_batch_id: null,
      status_updated_at: now,
      updated_at: now,
    });

  if (!membership) {
    return;
  }

  const batch = await trx('pick_batches')
    .where({
      shop_id: shopId,
      pick_batch_id: membership.pick_batch_id,
    })
    .select('status')
    .forUpdate()
    .first();

  await trx('pick_batch_orders')
    .where({
      shop_id: shopId,
      lasyncro_order_id: lasyncroOrderId,
      pick_batch_id: membership.pick_batch_id,
    })
    .delete();

  const remainingOrders = await trx('pick_batch_orders')
    .where({
      shop_id: shopId,
      pick_batch_id: membership.pick_batch_id,
    })
    .count<{ count: string }>('* as count')
    .first();

  if (batch && Number(remainingOrders?.count ?? 0) === 0) {
    await trx('pick_batches')
      .where({
        shop_id: shopId,
        pick_batch_id: membership.pick_batch_id,
      })
      .update({
        status: 'cancelled',
        updated_at: now,
      });
  }

  console.info('[CANCEL_UNWIND_BATCH_DETACHED]', {
    shopId,
    lasyncroOrderId,
    pickBatchId: membership.pick_batch_id,
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