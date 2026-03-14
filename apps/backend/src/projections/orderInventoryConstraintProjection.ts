import { Knex } from 'knex';

/**
 * ORDER INVENTORY CONSTRAINT PROJECTION
 * -------------------------------------
 * Deterministically computes whether an order is inventory
 * constrained (oversell) using the canonical projections:
 *
 *   order_revenue_units
 *   inventory_truth
 *
 * This replaces the runtime worker
 * computeObligationFlagsForOrders().
 *
 * Deterministic properties:
 * - rebuild-safe
 * - replay-safe
 * - no side effects
 */
export async function projectOrderInventoryConstraints(
  trx: Knex.Transaction,
  orderIds: string[]
): Promise<void> {

  if (orderIds.length === 0) return;

  const rows = await trx
    .with('variant_demand', (qb) => {
      qb
        .from('order_revenue_units as ru')
        .join('orders as o', 'o.lasyncro_order_id', 'ru.lasyncro_order_id')
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
    .with('variant_stock', (qb) => {
      qb
        .from('inventory_truth as it')
        .select('it.lasyncro_variant_id')
        .sum({ stock: 'it.available_quantity' })
        .groupBy('it.lasyncro_variant_id');
    })
    .from('variant_demand as vd')
    .leftJoin('variant_stock as vs', 'vs.lasyncro_variant_id', 'vd.lasyncro_variant_id')
    .select('vd.lasyncro_order_id')
    .max({
      oversell: trx.raw(`
        CASE
          WHEN vd.cumulative_demand > COALESCE(vs.stock,0)
          THEN 1
          ELSE 0
        END
      `)
    })
    .whereIn('vd.lasyncro_order_id', orderIds)
    .groupBy('vd.lasyncro_order_id');

  for (const row of rows as any[]) {
    await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: row.lasyncro_order_id })
      .update({
        inventory_block_type: Number(row.oversell) === 1 ? 'oversell' : null
      });
  }
}