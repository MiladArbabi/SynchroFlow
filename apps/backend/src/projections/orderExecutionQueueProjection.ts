import { Knex } from 'knex';

/**
 * ORDER EXECUTION QUEUE PROJECTION
 * --------------------------------
 * Computes operational execution queues used by
 * operational intelligence dashboards.
 *
 * Derived from:
 * - order_risk_snapshot
 * - order_fulfillment_status
 * - order_revenue_units
 *
 * Guarantees:
 * - deterministic rebuild
 * - no wall clock influence
 */

export async function projectExecutionQueues(
  trx: Knex.Transaction,
  shopId: string
) {

  const queueManualReview = await trx('order_risk_snapshot')
    .where({ shop_id: shopId })
    .andWhere('is_customer_blocked', true)
    .count<{ count: string }>('lasyncro_order_id as count')
    .first();

  const queueAwaitingInventory = await trx('order_risk_snapshot')
    .where({ shop_id: shopId })
    .andWhere('is_inventory_blocked', true)
    .count<{ count: string }>('lasyncro_order_id as count')
    .first();

  const queueAwaitingCustomer = await trx('order_risk_snapshot')
    .where({ shop_id: shopId })
    .andWhere('is_customer_blocked', true)
    .count<{ count: string }>('lasyncro_order_id as count')
    .first();

  const queueReadyToShip = await trx('order_fulfillment_status as ofs')
    .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('ofs.status', 'pending')
    .count<{ count: string }>('ofs.lasyncro_order_id as count')
    .first();

  const partialFulfillmentOpportunity = await trx('order_revenue_units')
    .join('orders as o', 'o.lasyncro_order_id', 'order_revenue_units.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .countDistinct<{ count: string }>('order_revenue_units.lasyncro_order_id as count')
    .first();

  return {
    queueManualReview: Number(queueManualReview?.count ?? 0),
    queueAwaitingInventory: Number(queueAwaitingInventory?.count ?? 0),
    queueAwaitingCustomer: Number(queueAwaitingCustomer?.count ?? 0),
    queueReadyToShip: Number(queueReadyToShip?.count ?? 0),
    partialFulfillmentOpportunity: Number(partialFulfillmentOpportunity?.count ?? 0)
  };
}