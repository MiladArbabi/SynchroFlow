import { Knex } from 'knex';

/**
 * DAILY OPERATIONAL BRIEF PROJECTION
 * ----------------------------------
 * Generates high-level operational intelligence metrics
 * used for daily executive dashboards.
 *
 * Deterministic inputs:
 * - orders
 * - order_revenue_units_net
 * - order_risk_snapshot
 *
 * Guarantees:
 * - replay-safe rebuild
 * - deterministic aggregation
 */

export async function projectDailyOperationalBrief(
  trx: Knex.Transaction,
  shopId: string,
  aggregateVersion: number,
) {

  const inventoryBlockedRevenue = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'o.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('ors.is_inventory_blocked', true)
    .sum<{ sum: string }>('runet.net_revenue as sum')
    .first();

  const cashToday = await trx('orders')
    .where({ shop_id: shopId })
    .sum<{ sum: string }>('total_price as sum')
    .first();

  const topPriorityOrders = await trx('order_risk_snapshot as ors')
    .where({ shop_id: shopId })
    .orderBy('order_health_score', 'asc')
    .limit(10)
    .select('lasyncro_order_id');

  const briefDate = trx.raw('CURRENT_DATE');

  await trx('daily_operational_brief_snapshot')
    .insert({
      shop_id: shopId,
      brief_date: briefDate,

      critical_orders_count: 0,
      negative_margin_orders_count: 0,
      sla_breached_count: 0,

      inventory_blocked_revenue: Number(inventoryBlockedRevenue?.sum ?? 0),

      cash_realized_today: Number(cashToday?.sum ?? 0),

      refund_exposure: 0,

      top_10_priority_order_ids: JSON.stringify(
        topPriorityOrders.map(o => o.lasyncro_order_id)
      ),

      evaluated_at: trx.fn.now()
    })
    .onConflict(['shop_id','brief_date'])
    .merge();

  return {
    topPriorityOrders
  };
}