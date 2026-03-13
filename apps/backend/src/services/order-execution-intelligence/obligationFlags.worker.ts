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
  trx: Knex.Transaction,
  eventAnchor: Date
): Promise<void> {

  /**
   * TRANSACTION CONTRACT
   * --------------------
   * Obligation recomputation MUST participate
   * in reconciliation transaction.
   */
  if (orderIds.length === 0) return;

  /**
   * INVENTORY ALLOCATION RESULT
   * ---------------------------
   * Result of deterministic oversell allocation query.
   *
   * oversell:
   *   1 → order exceeds available inventory
   *   0 → order is executable
   *
   * The previous required/available aggregation model
   * was removed when chronological allocation replaced
   * naive stock comparison.
   */
  type InventoryRow = {
    lasyncro_order_id: string;
    oversell: number | string | null;
  };

  const inventoryRows = await trx
    .with('target_variants', (qb) => {
      qb
        .from('order_revenue_units')
        .select('lasyncro_variant_id')
        .whereIn('lasyncro_order_id', orderIds)
        .distinct();
    })
    .with('ordered_units', (qb) => {
      qb
        .from('order_revenue_units as ru')
        .join('orders as o', 'o.lasyncro_order_id', 'ru.lasyncro_order_id')
        .join('target_variants as tv', 'tv.lasyncro_variant_id', 'ru.lasyncro_variant_id')
        .select(
          'ru.lasyncro_order_id',
          'ru.lasyncro_variant_id',
          'o.order_created_at',
          'ru.quantity'
        )
        .select(
          trx.raw(`
            SUM(ru.quantity) OVER (
              PARTITION BY ru.lasyncro_variant_id
              ORDER BY o.order_created_at, ru.lasyncro_order_id
            ) AS cumulative_demand
          `)
        );
    })
    .with('stock', (qb) => {
      /**
       * INVENTORY SOURCE OF TRUTH
       * -------------------------
       * Constraint evaluation must read from the deterministic
       * inventory projection rather than recomputing ledger math.
       *
       * Using inventory_movements here previously duplicated
       * projection logic and caused rebuild drift.
       *
       * Architecture invariant:
       *   inventory_movements → inventory_truth → constraints
       */
      qb
        .from('inventory_truth as it')
        .select('it.lasyncro_variant_id')
        .sum({ stock: 'it.available_quantity' })
        .groupBy('it.lasyncro_variant_id');
    })
    .from('ordered_units as ou')
    .leftJoin('stock as s', 's.lasyncro_variant_id', 'ou.lasyncro_variant_id')
    .select('ou.lasyncro_order_id')
    .max({
      oversell: trx.raw(`
        CASE
          WHEN ou.cumulative_demand > COALESCE(s.stock,0)
          THEN 1
          ELSE 0
        END
      `)
    })
    .groupBy('ou.lasyncro_order_id') as InventoryRow[];


/**
 * INVENTORY CONSTRAINT MODEL
 * --------------------------
 * Inventory evaluation currently emits a single
 * constraint classification:
 *
 *   oversell → cumulative demand exceeds stock
 *
 * "stockout" classification was previously planned
 * but never implemented. Maintaining dead logic
 * creates misleading operational signals.
 *
 * If future constraint models require stockout
 * differentiation (e.g. zero-stock vs oversell),
 * it must be implemented with a deterministic
 * allocation algorithm.
 */
  const oversellOrders = new Set<string>();

  /**
   * ORDER-LEVEL INVENTORY CONSTRAINT
   * --------------------------------
   * An order is inventory-blocked if ANY of its variants
   * exceed available inventory under chronological allocation.
   */
  for (const row of inventoryRows) {
    if (
      orderIds.includes(row.lasyncro_order_id) &&
      Number(row.oversell) === 1
    ) {
      oversellOrders.add(row.lasyncro_order_id);
    }
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
      ...oversellOrders,
    ])
    .update({ inventory_block_type: null });

  // 5️⃣ Freshness mark
  await trx('order_fulfillment_status')
    .whereIn('lasyncro_order_id', orderIds)
    .update({
      /**
       * DETERMINISTIC TIMESTAMP RULE
       */
      obligation_evaluated_at: eventAnchor
    });
}
