import type { Knex } from 'knex';

/**
 * REVENUE METRICS
 * ----------------
 * Isolated revenue computation.
 * Pure read layer.
 */
export async function computeRevenueMetrics(
  trx: Knex.Transaction,
  shopId: string,
  snapshotCutoff: Date
) {

  /**
   * SAFE ACCESS: enforce DB row contracts for revenue metrics
   */
  type SumRow = { sum: number | string | null };

  function requireRow<T>(row: T | undefined, label: string): T {
    if (!row) {
      throw new Error(`[revenue.metrics] Missing ${label} — DB contract violation`);
    }
    return row;
  }

  const realizedRevenueRow = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .sum('runet.net_revenue as sum')
    .first();

  const realizedRevenue = Number(
    requireRow(realizedRevenueRow as SumRow | undefined, 'realizedRevenueRow').sum ?? 0
  );

  const pendingRevenueRow = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .join(
      'order_fulfillment_status as ofs',
      'ofs.lasyncro_order_id',
      'o.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .andWhere('o.payment_state', 'paid')
    .andWhereNot('ofs.status', 'fulfilled')
    .sum('runet.net_revenue as sum')
    .first();

  const pendingRevenue = Number(
    requireRow(pendingRevenueRow as SumRow | undefined, 'pendingRevenueRow').sum ?? 0
  );

  const atRiskRevenueRow = await trx('orders')
    .where({ shop_id: shopId })
    .andWhere('payment_state', 'unpaid')
    .andWhere('order_created_at', '<=', snapshotCutoff)
    .sum('total_price as sum')
    .first();

  const atRiskRevenue = Number(
    requireRow(atRiskRevenueRow as SumRow | undefined, 'atRiskRevenueRow').sum ?? 0
  );

  return {
    realizedRevenue,
    pendingRevenue,
    atRiskRevenue,
  };
}