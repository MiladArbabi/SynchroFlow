import type { Knex } from 'knex';
import {
  approachingFulfillmentSlaLeadSeconds,
  fulfillmentSlaSeconds,
} from '@lasyncro/shared/contracts/fulfillment-sla';

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

  // CRITICAL: use latest aggregate_version per order only.
  // order_age_snapshot is append-only — multiple rows per order exist.
  // Joining without version filter inflates all counts by ~3x.
  const agingBuckets = await trx
    .with('latest_age_snapshot', (qb) => {
      // Select only the single latest snapshot row per order.
      // DISTINCT ON guarantees one row per lasyncro_order_id — the one with highest aggregate_version.
      qb.from('order_age_snapshot as oas')
        .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .distinctOn('oas.lasyncro_order_id')
        .select('oas.lasyncro_order_id', 'oas.age_since_creation_seconds')
        .orderBy('oas.lasyncro_order_id')
        .orderBy('oas.aggregate_version', 'desc');
    })
    .from('latest_age_snapshot as oas')
    .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'oas.lasyncro_order_id')
    // CRITICAL: only count unfulfilled orders.
    // Fulfilled orders retain age_since_creation_seconds and corrupt aging distributions.
    .whereIn('ofs.status', ['pending', 'partially_fulfilled'])
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

  /**
   * APPROACHING FULFILLMENT SLA — SLA-SEM-01
   * ------------------------------------------
   * Canonical contract:
   * - payment-age only
   * - current/latest age snapshot only
   * - unfulfilled only
   * - already-breached orders excluded
   * - warning window = min(4h, 25% of configured SLA)
   *
   * This is deliberately distinct from creation-age Watch/Aging.
   */
  const slaSettingsRow = await trx('shop_operational_settings')
    .where({ shop_id: Number(shopId) })
    .select('fulfillment_sla_hours')
    .first();

  const fulfillmentSlaHours =
    Number(slaSettingsRow?.fulfillment_sla_hours ?? 24);
  const slaSeconds = fulfillmentSlaSeconds(fulfillmentSlaHours);
  const approachingLeadSeconds =
    approachingFulfillmentSlaLeadSeconds(fulfillmentSlaHours);
  const approachingFloorSeconds =
    slaSeconds - approachingLeadSeconds;

  const ordersAtSlaRiskRow = await trx
    .with('latest_sla_snapshot', (qb) => {
      qb.from('order_age_snapshot as oas')
        .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .distinctOn('oas.lasyncro_order_id')
        .select(
          'oas.lasyncro_order_id',
          'oas.age_since_paid_seconds',
          'oas.is_shipping_sla_breached'
        )
        .orderBy('oas.lasyncro_order_id')
        .orderBy('oas.aggregate_version', 'desc');
    })
    .from('latest_sla_snapshot as oas')
    .leftJoin(
      'order_fulfillment_status as ofs',
      'ofs.lasyncro_order_id',
      'oas.lasyncro_order_id'
    )
    .where((builder) => {
      builder
        .whereNull('ofs.status')
        .orWhereNot('ofs.status', 'fulfilled');
    })
    .whereNotNull('oas.age_since_paid_seconds')
    .andWhere('oas.is_shipping_sla_breached', false)
    .andWhere(
      'oas.age_since_paid_seconds',
      '>=',
      approachingFloorSeconds
    )
    .andWhere('oas.age_since_paid_seconds', '<', slaSeconds)
    .countDistinct('oas.lasyncro_order_id as count')
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