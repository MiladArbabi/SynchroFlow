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
  
  /**
   * CRITICAL DESIGN:
   * SLA metrics must NOT filter by order_created_at.
   * order_age_snapshot already encodes time-relative state.
   * Filtering by creation time corrupts aging distributions.
   */

  const agingBuckets = await trx('order_age_snapshot as oas')
    .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
    .where('o.shop_id', shopId)
    /**
     * DB CONTRACT: replace raw aggregation with explicit typed select
     * Ensures schema visibility and future type inference compatibility
     */
    .select([
      trx.raw('COUNT(*) FILTER (WHERE oas.age_since_creation_seconds < 86400) as aging_24h'),
      trx.raw('COUNT(*) FILTER (WHERE oas.age_since_creation_seconds >= 86400 AND oas.age_since_creation_seconds < 172800) as aging_48h'),
      trx.raw('COUNT(*) FILTER (WHERE oas.age_since_creation_seconds >= 172800 AND oas.age_since_creation_seconds < 259200) as aging_72h'),
      trx.raw('COUNT(*) FILTER (WHERE oas.age_since_creation_seconds >= 259200) as aging_72h_plus'),
    ])
    .first();

  /**
   * SAFE ACCESS: enforce typed DB row shape
   * Prevents silent runtime failures from unknown structures
   */
  type AgingBucketsRow = {
    aging_24h: number | string | null;
    aging_48h: number | string | null;
    aging_72h: number | string | null;
    aging_72h_plus: number | string | null;
  };

  const buckets = agingBuckets as AgingBucketsRow | undefined;

  if (!buckets) {
    throw new Error('[sla.metrics] Missing agingBuckets row — DB contract violation');
  }

  const aging24h = Number(buckets.aging_24h ?? 0);
  const aging48h = Number(buckets.aging_48h ?? 0);
  const aging72h = Number(buckets.aging_72h ?? 0);
  const aging72hPlus = Number(buckets.aging_72h_plus ?? 0);

  const ordersAtSlaRiskRow = await trx('order_age_snapshot as oas')
    .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('oas.age_since_creation_seconds', '>=', 86400)
    .count('* as count')
    .first();

  type CountRow = { count: number | string | null };

  const riskRow = ordersAtSlaRiskRow as CountRow | undefined;

  if (!riskRow) {
    throw new Error('[sla.metrics] Missing ordersAtSlaRiskRow — DB contract violation');
  }

  const ordersAtSlaRisk = Number(riskRow.count ?? 0);

  const slaBreach24hRevenueRow = await trx('orders as o')
    .where('o.shop_id', shopId)
    .andWhere('o.payment_state', 'paid')
    .whereNotExists(
      trx('order_fulfillment_status as ofs')
        .select(1)
        .whereRaw('ofs.lasyncro_order_id = o.lasyncro_order_id')
        .andWhere('ofs.status', 'fulfilled')
    )
    .sum('o.total_price as sum')
    .first();

  type SumRow = { sum: number | string | null };

  const breachRow = slaBreach24hRevenueRow as SumRow | undefined;

  if (!breachRow) {
    throw new Error('[sla.metrics] Missing slaBreach24hRevenueRow — DB contract violation');
  }

  const slaBreach24hRevenue = Number(breachRow.sum ?? 0);

  return {
    aging24h,
    aging48h,
    aging72h,
    aging72hPlus,
    ordersAtSlaRisk,
    slaBreach24hRevenue,
  };
}