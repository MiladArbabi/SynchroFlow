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

  /**
   * Inventory aggregation row
   *
   * required_quantity:
   *   SUM(order_revenue_units.quantity)
   *
   * total_available:
   *   SUM(inventory_truth.available_quantity)
   *
   * lasyncro_order_id:
   *   order identity anchor
   */
  type InventoryRow = {
    lasyncro_order_id: string;
    required_quantity: string | number | null;
    total_available: string | number | null;
  };

  /**
   * INVENTORY OBLIGATION EVALUATION
   * --------------------------------
   * Correct rule:
   * An order is inventory-blocked only when
   * available inventory < required order quantity.
   *
   * Previous implementation incorrectly summed
   * inventory availability only, ignoring required
   * quantities. That caused every order to appear
   * blocked when inventory levels were small.
   *
   * Deterministic invariant:
   *   required_quantity > available_quantity → blocked
   */

  const inventoryRows = await trx('order_revenue_units as ru')
    .leftJoin('inventory_truth as it', function () {
      this.on('it.lasyncro_variant_id', '=', 'ru.lasyncro_variant_id');
    })
    .whereIn('ru.lasyncro_order_id', orderIds)
    .groupBy('ru.lasyncro_order_id')
    .select('ru.lasyncro_order_id')
    .sum({ required_quantity: 'ru.quantity' })
    .sum({ total_available: 'it.available_quantity' }) as InventoryRow[];

  const stockoutOrders = new Set<string>();
  const oversellOrders = new Set<string>();

  for (const row of inventoryRows) {
    const required = Number(row.required_quantity ?? 0);
    const available = Number(row.total_available ?? 0);

    /**
     * Deterministic stock evaluation
     *
     * available >= required  → executable
     * available == 0         → stockout
     * available < required   → oversell
     */

    if (available === 0 && required > 0) {
      stockoutOrders.add(row.lasyncro_order_id);
    } else if (available < required) {
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
