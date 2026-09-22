import { withTenant } from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import { fulfillmentSlaSeconds, approachingFulfillmentSlaLeadSeconds, isApproachingFulfillmentSla } from '@lasyncro/shared/contracts/fulfillment-sla';

// One anchor precedence for projection, read-time assessment and SQL ordering.
const ANCHOR_FIELDS = ['paid_at', 'captured_at', 'order_processed_at', 'order_created_at'] as const;
export type SlaOrderClock = Partial<Record<typeof ANCHOR_FIELDS[number], Date | string | null>>;
export function fulfillmentSlaAnchor(order: SlaOrderClock): Date | string | null {
  return ANCHOR_FIELDS.map(field => order[field]).find(value => value != null) ?? null;
}
export function currentPaidAgeSeconds(order: SlaOrderClock, now: Date): number | null {
  const anchor = fulfillmentSlaAnchor(order);
  if (anchor == null) return null;
  const elapsed = now.getTime() - new Date(anchor).getTime();
  return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed / 1000)) : null;
}
export function currentSlaState(age: number | null, hours: number | null | undefined, status: string | null) {
  if (age == null || status === 'fulfilled' || status === 'cancelled' || status == null) return null;
  if (age >= fulfillmentSlaSeconds(hours)) return 'breached' as const;
  return isApproachingFulfillmentSla({ ageSincePaidSeconds: age, fulfillmentSlaHours: hours }) ? 'approaching' as const : 'normal' as const;
}

// Internal aliases o/ofs only. Thresholds are supplied by the shared contract,
// never separately maintained SQL constants. PostgreSQL NOW is transaction-stable.
export function currentFulfillmentSlaSql(hours: number | null | undefined) {
  const age = `GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(${ANCHOR_FIELDS.map(field => `o.${field}`).join(', ')})))))`;
  const seconds = fulfillmentSlaSeconds(hours);
  const floor = seconds - approachingFulfillmentSlaLeadSeconds(hours);
  const state = `CASE WHEN ofs.status IS NULL OR ofs.status IN ('fulfilled', 'cancelled') THEN NULL WHEN ${age} >= ${seconds} THEN 'breached' WHEN ${age} >= ${floor} THEN 'approaching' ELSE 'normal' END`;
  const rank = `CASE (${state}) WHEN 'breached' THEN 2 WHEN 'approaching' THEN 1 ELSE 0 END`;
  return { age, state, rank, breached: `COALESCE((${state}) = 'breached', false)` };
}

export interface CurrentFulfillmentSlaSummary {
  fulfillmentSlaHours: number;
  breachedCount: number;
  breachedRevenue: number;
  approachingCount: number;
}

/**
 * Canonical CURRENT Fulfillment SLA summary.
 *
 * Current truth is derived from order timestamps + NOW(), never from
 * order_age_snapshot age/breach fields.
 *
 * Reuses an existing tenant-scoped transaction when supplied so callers such
 * as the alerts aggregator do not open nested transactions.
 */
export async function readCurrentFulfillmentSlaSummary(
  shopId: number,
  trx?: Knex.Transaction
): Promise<CurrentFulfillmentSlaSummary> {
  const run = async (
    t: Knex.Transaction
  ): Promise<CurrentFulfillmentSlaSummary> => {
    const settings = await t('shop_operational_settings')
      .where({ shop_id: shopId })
      .first('fulfillment_sla_hours');

    const configuredHours = settings?.fulfillment_sla_hours;
    const fulfillmentSlaHours =
      fulfillmentSlaSeconds(configuredHours) / 3600;

    const currentSla = currentFulfillmentSlaSql(configuredHours);

    const row = await t('orders as o')
      .leftJoin(
        'order_fulfillment_status as ofs',
        'ofs.lasyncro_order_id',
        'o.lasyncro_order_id'
      )
      .where('o.shop_id', shopId)
      .select(
        t.raw(`
          COUNT(*) FILTER (
            WHERE ${currentSla.state} = 'breached'
          ) AS breached_count
        `),
        t.raw(`
          COALESCE(
            SUM(
              CASE
                WHEN ${currentSla.state} = 'breached'
                  THEN o.total_price
                ELSE 0
              END
            ),
            0
          ) AS breached_revenue
        `),
        t.raw(`
          COUNT(*) FILTER (
            WHERE ${currentSla.state} = 'approaching'
          ) AS approaching_count
        `)
      )
      .first();

    return {
      fulfillmentSlaHours,
      breachedCount: Number(row?.breached_count ?? 0),
      breachedRevenue: Number(row?.breached_revenue ?? 0),
      approachingCount: Number(row?.approaching_count ?? 0),
    };
  };

  return trx ? run(trx) : withTenant(shopId, run);
}
