import { Knex } from 'knex';

/**
 * ORDER OPERATIONAL SIGNALS RESOLVER
 * ==================================
 *
 * NOT A PROJECTION.
 *
 * Computes operational intelligence signals dynamically
 * from projection state.
 *
 * Reads from:
 * - order_risk_snapshot
 * - order_margin_snapshot
 * - order_age_snapshot
 *
 * This module intentionally does NOT write a snapshot table
 * and therefore must NOT be registered in the projection
 * safety system.
 */

export async function resolveOperationalSignals(
  trx: Knex.Transaction,
  shopId: string
) {

  const criticalOrders = await trx('order_risk_snapshot')
    .where({ shop_id: shopId })
    .andWhere('order_health_score', '<', 50)
    .count<{ count: string }>('lasyncro_order_id as count')
    .first();

  const negativeMarginOrders = await trx('order_margin_snapshot')
    .join('orders as o', 'o.lasyncro_order_id', 'order_margin_snapshot.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('margin_pct', '<', 0)
    .count<{ count: string }>('order_margin_snapshot.lasyncro_order_id as count')
    .first();

  const slaBreachedOrders = await trx('order_age_snapshot as oas')
    .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('oas.age_since_paid_seconds', '>', 86400)
    .count<{ count: string }>('oas.lasyncro_order_id as count')
    .first();

  const topPriorityOrders = await trx('order_risk_snapshot')
    .where({ shop_id: shopId })
    .orderBy('order_health_score', 'asc')
    .limit(10)
    .select('lasyncro_order_id');

  return {
    criticalOrders: Number(criticalOrders?.count ?? 0),
    negativeMarginOrders: Number(negativeMarginOrders?.count ?? 0),
    slaBreachedOrders: Number(slaBreachedOrders?.count ?? 0),
    topPriorityOrders
  };
}