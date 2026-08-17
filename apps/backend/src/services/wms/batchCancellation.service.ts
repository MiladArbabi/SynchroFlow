import type { Knex } from 'knex';
import { randomUUID } from 'crypto';

export async function cancelUnclaimedBatch(
  trx: Knex.Transaction,
  shopId: number,
  batchId: string
) {
  const batch = await trx('pick_batches')
    .where({
      shop_id: shopId,
      pick_batch_id: batchId,
    })
    .select('status')
    .forUpdate()
    .first();

  if (!batch) {
    throw new Error('BATCH_NOT_FOUND');
  }

  if (batch.status !== 'pending') {
    throw new Error(`BATCH_NOT_CANCELLABLE:${batch.status}`);
  }

  const batchOrders = await trx('pick_batch_orders')
    .where({ pick_batch_id: batchId })
    .select('lasyncro_order_id');

  /*
   * Reservation holds are aggregate batch + variant + location ledger rows.
   * They are the arithmetic source for cancellation; ownership allocations
   * may contain multiple rows for the same held inventory.
   */
  const holds = await trx('inventory_movements')
    .where({
      shop_id: shopId,
      reference_type: 'pick_batch',
      reference_id: batchId,
      movement_type: 'reservation_hold',
    })
    .select(
      'lasyncro_variant_id',
      'location_code',
      'quantity_delta'
    );

  let releasedUnits = 0;

  for (const hold of holds) {
    const releasedQuantity = Number(hold.quantity_delta);

    if (
      !Number.isInteger(releasedQuantity) ||
      releasedQuantity <= 0
    ) {
      throw new Error(
        `BATCH_RESERVATION_HOLD_INVALID:${hold.lasyncro_variant_id}:${hold.location_code}`
      );
    }

    const releasedAt = new Date();

    const insertedRelease = await trx('inventory_movements')
      .insert({
        lasyncro_inventory_movement_id: randomUUID(),
        lasyncro_variant_id: hold.lasyncro_variant_id,
        shop_id: shopId,
        movement_type: 'reservation_release',
        quantity_delta: -releasedQuantity,
        location_code: hold.location_code,
        reference_type: 'pick_batch',
        reference_id: batchId,
        platform: 'wms',
        occurred_at: releasedAt,
        operator_id: null,
        triggered_by: 'batch_cancelled',
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

    if (insertedRelease.length !== 1) {
      throw new Error(
        `BATCH_RESERVATION_RELEASE_CONFLICT:${hold.lasyncro_variant_id}:${hold.location_code}`
      );
    }

    const updatedTruthRows = await trx('inventory_truth')
      .where({
        shop_id: shopId,
        lasyncro_variant_id: hold.lasyncro_variant_id,
        location_code: hold.location_code,
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
        `BATCH_RESERVATION_RELEASE_FAILED:${hold.lasyncro_variant_id}:${hold.location_code}`
      );
    }

    releasedUnits += releasedQuantity;
  }

  await trx('pick_reservation_allocations')
    .where({
      shop_id: shopId,
      pick_batch_id: batchId,
    })
    .delete();

  await trx('pick_batch_orders')
    .where({ pick_batch_id: batchId })
    .delete();

  const updatedBatchRows = await trx('pick_batches')
    .where({
      shop_id: shopId,
      pick_batch_id: batchId,
      status: 'pending',
    })
    .update({
      status: 'cancelled',
      updated_at: new Date(),
    });

  if (updatedBatchRows !== 1) {
    throw new Error('BATCH_CANCEL_STATE_UPDATE_FAILED');
  }

  return {
    pick_batch_id: batchId,
    status: 'cancelled' as const,
    returned_order_count: batchOrders.length,
    released_reservation_count: holds.length,
    released_units: releasedUnits,
  };
}