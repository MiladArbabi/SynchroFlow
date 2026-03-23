import type { Knex } from 'knex';

/**
 * SLA & AGING METRICS
 * -------------------
 * Time-based operational risk and aging buckets.
 */
export async function computeSlaMetrics(
  trx: Knex.Transaction,
  shopId: string,
  snapshotCutoff: Date
) {
  const agingBuckets = await trx('order_age_snapshot as oas')
    .where('oas.shop_id', shopId)
    .andWhere('oas.created_at', '<=', snapshotCutoff)
    .select(
      trx.raw(`
        SUM(CASE WHEN oas.age_hours < 24 THEN 1 ELSE 0 END) as aging_under_24h,
        SUM(CASE WHEN oas.age_hours >= 24 AND oas.age_hours < 48 THEN 1 ELSE 0 END) as aging_48h,
        SUM(CASE WHEN oas.age_hours >= 48 THEN 1 ELSE 0 END) as aging_72h_plus
      `)
    )
    .first();

  const agingUnder24h = Number((agingBuckets as any)?.aging_under_24h ?? 0);
  const aging48h = Number((agingBuckets as any)?.aging_48h ?? 0);
  const aging72hPlus = Number((agingBuckets as any)?.aging_72h_plus ?? 0);

  const ordersAtSlaRiskRow = await trx('order_age_snapshot as oas')
    .where('oas.shop_id', shopId)
    .andWhere('oas.created_at', '<=', snapshotCutoff)
    .andWhere('oas.age_hours', '>=', 24)
    .count('* as count')
    .first();

  const ordersAtSlaRisk = Number((ordersAtSlaRiskRow as any)?.count ?? 0);

  const slaBreach24hRevenueRow = await trx('orders as o')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .andWhere('o.payment_state', 'paid')
    .whereNotExists(
      trx('order_fulfillment_status as ofs')
        .select(1)
        .whereRaw('ofs.lasyncro_order_id = o.lasyncro_order_id')
        .andWhere('ofs.status', 'fulfilled')
    )
    .sum('o.total_price as sum')
    .first();

  const slaBreach24hRevenue = Number((slaBreach24hRevenueRow as any)?.sum ?? 0);

  return {
    agingUnder24h,
    aging48h,
    aging72hPlus,
    ordersAtSlaRisk,
    slaBreach24hRevenue,
  };
}