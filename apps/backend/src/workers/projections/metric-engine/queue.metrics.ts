import type { Knex } from 'knex';

/**
 * QUEUE METRICS
 * -------------
 * Operational queues and readiness states.
 */
export async function computeQueueMetrics(
  trx: Knex.Transaction,
  shopId: string,
  snapshotCutoff: Date
) {
  const queueManualReviewRow = await trx('order_constraint_events')
    .where({ shop_id: shopId })
    .andWhere('constraint_type', 'manual_review')
    .count('* as count')
    .first();

  const queueManualReview = Number((queueManualReviewRow as any)?.count ?? 0);

  const queueAwaitingInventoryRow = await trx('order_constraint_events')
    .where({ shop_id: shopId })
    .andWhere('constraint_type', 'inventory')
    .count('* as count')
    .first();

  const queueAwaitingInventory = Number((queueAwaitingInventoryRow as any)?.count ?? 0);

  const queueAwaitingCustomerRow = await trx('order_constraint_events')
    .where({ shop_id: shopId })
    .andWhere('constraint_type', 'customer')
    .count('* as count')
    .first();

  const queueAwaitingCustomer = Number((queueAwaitingCustomerRow as any)?.count ?? 0);

  const queueReadyToShipRow = await trx('orders as o')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .andWhere('o.payment_state', 'paid')
    .count('* as count')
    .first();

  const queueReadyToShip = Number((queueReadyToShipRow as any)?.count ?? 0);

  const readyToShipRevenueRow = await trx('order_revenue_units as oru')
    .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .sum('oru.net_revenue as sum')
    .first();

  const readyToShipRevenue = Number((readyToShipRevenueRow as any)?.sum ?? 0);

  return {
    queueManualReview,
    queueAwaitingInventory,
    queueAwaitingCustomer,
    queueReadyToShip,
    readyToShipRevenue,
  };
}