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

  /**
   * SAFE ACCESS: enforce DB row contracts for queue metrics
   */
  type CountRow = { count: number | string | null };
  type SumRow = { sum: number | string | null };

  function requireRow<T>(row: T | undefined, label: string): T {
    if (!row) {
      throw new Error(`[queue.metrics] Missing ${label} — DB contract violation`);
    }
    return row;
  }

  const queueManualReviewRow = await trx('order_constraint_events')
    .where({ shop_id: shopId })
    .andWhere('constraint_type', 'manual_review')
    .count('* as count')
    .first();

  const queueManualReview = Number(
    requireRow(queueManualReviewRow as CountRow | undefined, 'queueManualReviewRow').count ?? 0
  );

  const queueAwaitingInventoryRow = await trx('order_constraint_events')
    .where({ shop_id: shopId })
    .andWhere('constraint_type', 'inventory')
    .count('* as count')
    .first();

  const queueAwaitingInventory = Number(
    requireRow(queueAwaitingInventoryRow as CountRow | undefined, 'queueAwaitingInventoryRow').count ?? 0
  );

  const queueAwaitingCustomerRow = await trx('order_constraint_events')
    .where({ shop_id: shopId })
    .andWhere('constraint_type', 'customer')
    .count('* as count')
    .first();

  const queueAwaitingCustomer = Number(
    requireRow(queueAwaitingCustomerRow as CountRow | undefined, 'queueAwaitingCustomerRow').count ?? 0
  );

  const queueReadyToShipRow = await trx('orders as o')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .andWhere('o.payment_state', 'paid')
    .count('* as count')
    .first();

  const queueReadyToShip = Number(
    requireRow(queueReadyToShipRow as CountRow | undefined, 'queueReadyToShipRow').count ?? 0
  );

  const readyToShipRevenueRow = await trx('order_revenue_units_net as oru')
    .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .sum('oru.net_revenue as sum')
    .first();

  const readyToShipRevenue = Number(
    requireRow(readyToShipRevenueRow as SumRow | undefined, 'readyToShipRevenueRow').sum ?? 0
  );

  return {
    queueManualReview,
    queueAwaitingInventory,
    queueAwaitingCustomer,
    queueReadyToShip,
    readyToShipRevenue,
  };
}