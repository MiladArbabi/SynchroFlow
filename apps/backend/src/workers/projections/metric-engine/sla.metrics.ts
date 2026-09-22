import type { Knex } from 'knex';
import { readCurrentFulfillmentSlaSummary } from '../../../services/orders/fulfillmentSla.service.js';

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
   * CURRENT FULFILLMENT SLA — SLA-CANONICAL-01D
   * --------------------------------------------
   * Current SLA is time-driven and must not depend on order_age_snapshot.
   *
   * The canonical reader owns:
   * - merchant-configured SLA duration
   * - anchor precedence
   * - NOW()-relative age
   * - fulfilled/cancelled exclusion
   * - inclusive breach boundary
   * - approaching-window semantics
   *
   * Aging buckets above intentionally remain historical snapshot metrics;
   * only current Fulfillment SLA truth is consolidated here.
   */
  const currentSla = await readCurrentFulfillmentSlaSummary(
    Number(shopId),
    trx
  );

  const ordersAtSlaRisk = currentSla.approachingCount;
  const slaBreachedRevenue = currentSla.breachedRevenue;

  return {
    aging24h,
    aging48h,
    aging72h,
    aging72hPlus,
    ordersAtSlaRisk,
    slaBreachedRevenue,
  };
}
