// apps/backend/src/services/overview-ft2/overviewPulse.resolver.ts
//
// Business Pulse Resolver (OVR-04)
// --------------------------------
// Cross-domain financial "is the business winning today?" rail for the
// Overview right column. Distinct from Orders' Today's Flow: Flow counts
// work-in-progress queues; Pulse reports business OUTCOMES (money realized,
// at-risk, stuck).
//
// Sources (both per-shop, tenant-scoped):
//   - revenue_projection_daily          → today's gross revenue + yesterday delta
//   - orders_operational_control_snapshot → at-risk / blocked revenue
//
// No customers/analytics dependency (customers module deprecated).
// Caller MUST set app.current_tenant before invoking.

import db from '@lasyncro/backend-core/db.js';

export interface OverviewPulse {
  /**
   * OV-122: gross revenue for the CURRENT date specifically — 0 when there
   * were no sales today. Previously this returned the latest available row
   * regardless of its date, so a shop with no recent orders saw stale figures
   * labelled "today" (the reviewer account displayed 45-day-old revenue).
   * A day with no sales is a real and unremarkable state; showing 0 is
   * accurate, whereas showing an old number is not.
   */
  revenueToday: number;
  /**
   * Delta vs the immediately preceding calendar day (also 0 when absent).
   * Both operands are now anchored to explicit dates, so this can no longer
   * compare two non-consecutive days that merely happen to be adjacent rows.
   */
  revenueDeltaVsYesterday: number;
  /** Revenue exposed but not yet lost (opctl). */
  atRiskRevenue: number | null;
  /** Revenue currently blocked from shipping (opctl). */
  blockedRevenue: number | null;
  /** Dominant block domain: inventory | customer | operational | none. */
  topBlockingType: string | null;
}

type RevenueDateWindow = {
  today: string;
  yesterday: string;
};

function formatShopLocalDate(timezone: string | null, now: Date): string {
  const zone = timezone ?? 'UTC';

  const format = (timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(zone);
  } catch {
    console.warn('[overviewPulse] unknown timezone, falling back to UTC', { timezone });
    parts = format('UTC');
  }

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function resolveShopRevenueDateWindow(
  timezone: string | null,
  now: Date = new Date()
): RevenueDateWindow {
  const today = formatShopLocalDate(timezone, now);
  const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);

  return {
    today,
    yesterday: yesterdayDate.toISOString().slice(0, 10),
  };
}

export async function getOverviewPulse(shopId: number, now: Date = new Date()): Promise<OverviewPulse> {
  return db.transaction(async (trx) => {
    // Both revenue_projection_daily and orders_operational_control_snapshot
    // have strict RLS policies requiring app.current_tenant. Without SET LOCAL
    // both queries silently return zero rows even with an explicit shop_id filter.
    // This function owns its queries and therefore owns its own tenant context.
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const shopRow = await trx('shops')
      .where({ id: shopId })
      .first('timezone');
    const { today, yesterday } = resolveShopRevenueDateWindow(shopRow?.timezone ?? null, now);

    // OV-122: query the two specific calendar dates rather than the two most
    // recent rows. Missing row = no sales that day = 0, not "unknown".
    /**
     * OV-122: Postgres labels the rows, not JS. A DATE column comes back as
     * local midnight, so new Date(...).toISOString() shifts it into the
     * previous day for any timezone east of UTC — building map keys that way
     * silently mismatched every row (Stockholm is UTC+2 in summer).
     * Comparing dates in SQL keeps a single source of truth for "today".
     */
    const revenueRows = await trx('revenue_projection_daily')
      .where({ shop_id: shopId })
      .whereIn('revenue_date', [today, yesterday])
      .select(
        trx.raw('revenue_date::text as revenue_date'),
        'gross_revenue'
      );

  const revenueToday = Number(
    revenueRows.find((r: { revenue_date: string }) => r.revenue_date === today)?.gross_revenue ?? 0
  );
  const revenueYesterday = Number(
    revenueRows.find((r: { revenue_date: string }) => r.revenue_date === yesterday)?.gross_revenue ?? 0
  );
  const revenueDeltaVsYesterday = revenueToday - revenueYesterday;

   // --- Operational revenue control: latest snapshot_date row ---
   const opctl = await trx('orders_operational_control_snapshot')
      .where({ shop_id: shopId })
      .orderBy('snapshot_date', 'desc')
      .first(
        'at_risk_revenue',
        'blocked_revenue',
        'top_blocking_type'
      );

  return {
    revenueToday,
    revenueDeltaVsYesterday,
    atRiskRevenue:
      opctl?.at_risk_revenue != null ? Number(opctl.at_risk_revenue) : null,
    blockedRevenue:
      opctl?.blocked_revenue != null ? Number(opctl.blocked_revenue) : null,
    topBlockingType: opctl?.top_blocking_type ?? null,
    };
  });
}
