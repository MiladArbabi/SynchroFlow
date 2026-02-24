import { Knex } from 'knex';

/**
 * ORDER-SCOPED Obligation Flag Evaluation
 * ----------------------------------------
 * Recomputes obligation flags for specific orders only.
 *
 * Guarantees:
 * - Deterministic
 * - Idempotent
 * - No shop-wide scans
 * - Safe under concurrent reconciliation
 */
export async function computeObligationFlagsForOrders(
  orderIds: string[],
  trx: Knex.Transaction
): Promise<void> {

  /**
   * TRANSACTION CONTRACT
   * --------------------
   * Obligation recomputation MUST participate
   * in reconciliation transaction.
   */
  if (orderIds.length === 0) return;

  type InventoryRow = {
    lasyncro_order_id: string;
    total_available: string | number | null;
  };

  // 1️⃣ Aggregate availability only for affected orders
  const inventoryRows = await trx('order_revenue_units as ru')
    .leftJoin('inventory_truth as it', function () {
      this.on('it.lasyncro_variant_id', '=', 'ru.lasyncro_variant_id');
    })
    .whereIn('ru.lasyncro_order_id', orderIds)
    .groupBy('ru.lasyncro_order_id')
    .select('ru.lasyncro_order_id')
    .sum({ total_available: 'it.available_quantity' }) as InventoryRow[];

  const stockoutOrders = new Set<string>();
  const oversellOrders = new Set<string>();

  for (const row of inventoryRows) {
    if (row.total_available == null) continue;

    const available = Number(row.total_available);

    if (available === 0) {
      stockoutOrders.add(row.lasyncro_order_id);
    } else if (available < 0) {
      oversellOrders.add(row.lasyncro_order_id);
    }
  }

  // 2️⃣ Write stockout classification
  if (stockoutOrders.size > 0) {
    await trx('order_fulfillment_status')
      .whereIn('lasyncro_order_id', Array.from(stockoutOrders))
      .update({ inventory_block_type: 'stockout' });
  }

  // 3️⃣ Write oversell classification
  if (oversellOrders.size > 0) {
    await trx('order_fulfillment_status')
      .whereIn('lasyncro_order_id', Array.from(oversellOrders))
      .update({ inventory_block_type: 'oversell' });
  }

  // 4️⃣ Clear executable orders
  await trx('order_fulfillment_status')
    .whereIn('lasyncro_order_id', orderIds)
    .whereNotIn('lasyncro_order_id', [
      ...stockoutOrders,
      ...oversellOrders,
    ])
    .update({ inventory_block_type: null });

  // 5️⃣ Freshness mark
  await trx('order_fulfillment_status')
    .whereIn('lasyncro_order_id', orderIds)
    .update({
      obligation_evaluated_at: trx.fn.now(),
    });
}
