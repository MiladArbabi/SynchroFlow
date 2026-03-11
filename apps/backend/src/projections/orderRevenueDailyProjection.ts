import { Knex } from 'knex';

/**
 * ORDER REVENUE DAILY PROJECTION
 * ------------------------------
 * Aggregates deterministic daily revenue metrics.
 *
 * Source tables:
 * - order_revenue_units_net
 * - orders
 *
 * Guarantees:
 * - deterministic aggregation
 * - replay-safe rebuild
 */
export async function projectRevenueDaily(
  trx: Knex.Transaction,
  shopId: string
) {

  const dailyRows = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .select(
      trx.raw('DATE(runet.created_at) as revenue_date'),
      trx.raw('SUM(runet.net_revenue) as revenue_sum')
    )
    .groupByRaw('DATE(runet.created_at)');

  for (const row of dailyRows) {

    await trx('revenue_projection_daily')
      .insert({
        shop_id: shopId,
        revenue_date: row.revenue_date,
        revenue_sum: Number(row.revenue_sum ?? 0)
      })
      .onConflict(['shop_id', 'revenue_date'])
      .merge();
  }
}