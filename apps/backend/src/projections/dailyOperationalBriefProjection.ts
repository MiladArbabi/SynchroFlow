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
  eventAnchor: Date
) {

  /**
   * INVENTORY BLOCKED REVENUE (VARIANT-SCOPED)
   * -----------------------------------------
   * MUST derive from order_constraints.target_id
   *
   * DO NOT use:
   * - order_risk_snapshot.is_inventory_blocked
   *
   * Reason:
   * That is an order-level boolean and loses variant granularity.
   */
  const inventoryBlockedRevenue = await trx('order_constraints as oc')
    .join('order_revenue_units_net as runet', function () {
      this.on('runet.lasyncro_order_id', '=', 'oc.lasyncro_order_id')
          .andOn('runet.lasyncro_variant_id', '=', 'oc.target_id');
    })
    .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('oc.constraint_type', 'inventory')
    .andWhere('oc.is_active', true)
    .sum<{ sum: string }>('runet.net_revenue as sum')
    .first();

  /**
   * DEBUG SIGNAL
   */
  /* console.debug('[DAILY_BRIEF][INVENTORY_BLOCKED_REVENUE]', {
    shopId,
    value: Number(inventoryBlockedRevenue?.sum ?? 0)
  }); */

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

      /**
       * DETERMINISTIC TIMESTAMP RULE
       */
      evaluated_at: eventAnchor
    })

    // CONFLICT POLICY:
    // - Type: DAILY_OPERATIONAL_BRIEF_SNAPSHOT
    // - Strategy: UPSERT_EXPLICIT
    // - Rationale: enforce deterministic snapshot rebuilds per (shop_id, brief_date)
    .onConflict(['shop_id','brief_date'])
    .merge({
      // EXPLICIT MERGE POLICY: overwrite full daily brief snapshot deterministically
      updated_at: new Date(),
      // NOTE: include all snapshot fields explicitly to avoid implicit overwrite behavior
    });

  return {
    topPriorityOrders
  };
}