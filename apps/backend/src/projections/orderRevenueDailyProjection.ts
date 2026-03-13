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
  shopId: string,
  aggregateVersion: number,
  eventAnchor: Date
) {

  const dailyRows = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .leftJoin('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .select(
      trx.raw('DATE(runet.created_at) as revenue_date'),
      trx.raw('SUM(runet.net_revenue) as gross_revenue'),
      trx.raw('COUNT(DISTINCT o.lasyncro_order_id) as order_count'),
      trx.raw(`
        SUM(
          CASE WHEN ors.is_at_risk = true
          THEN runet.net_revenue
          ELSE 0
          END
        ) as at_risk_revenue
      `)
    )
    .groupByRaw('DATE(runet.created_at)');

  for (const row of dailyRows) {

    await trx('revenue_projection_daily')
      .insert({
        shop_id: shopId,
        revenue_date: row.revenue_date,
        gross_revenue: Number(row.gross_revenue ?? 0),
        order_count: Number(row.order_count ?? 0),
        at_risk_revenue: Number(row.at_risk_revenue ?? 0),
        /**
         * DETERMINISTIC TIMESTAMP RULE
         * ----------------------------
         * Projection timestamps must derive from
         * canonical domain event time.
         *
         * Wall-clock timestamps break deterministic rebuilds.
         */
        evaluated_at: eventAnchor
      })
      .onConflict(['shop_id', 'revenue_date'])
      .merge();
  }
}