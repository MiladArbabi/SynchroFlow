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
//   - orders_operational_control_snapshot → realized / at-risk / blocked revenue
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
  /** Revenue already collected/realized today (opctl). */
  collectedRevenue: number | null;
  /** Revenue exposed but not yet lost (opctl). */
  atRiskRevenue: number | null;
  /** Revenue currently blocked from shipping (opctl). */
  blockedRevenue: number | null;
  /** Dominant block domain: inventory | customer | operational | none. */
  topBlockingType: string | null;
}

export async function getOverviewPulse(shopId: number): Promise<OverviewPulse> {
  return db.transaction(async (trx) => {
    // Both revenue_projection_daily and orders_operational_control_snapshot
    // have strict RLS policies requiring app.current_tenant. Without SET LOCAL
    // both queries silently return zero rows even with an explicit shop_id filter.
    // This function owns its queries and therefore owns its own tenant context.
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

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
      .whereRaw(`revenue_date IN (CURRENT_DATE, CURRENT_DATE - INTERVAL '1 day')`)
      .select(
        trx.raw(`(revenue_date = CURRENT_DATE) as is_today`),
        'gross_revenue'
      );

  const revenueToday = Number(
    revenueRows.find((r: { is_today: boolean }) => r.is_today)?.gross_revenue ?? 0
  );
  const revenueYesterday = Number(
    revenueRows.find((r: { is_today: boolean }) => !r.is_today)?.gross_revenue ?? 0
  );
  const revenueDeltaVsYesterday = revenueToday - revenueYesterday;

   // --- Operational revenue control: latest snapshot_date row ---
   const opctl = await trx('orders_operational_control_snapshot')
      .where({ shop_id: shopId })
      .orderBy('snapshot_date', 'desc')
      .first(
        'realized_revenue',
        'at_risk_revenue',
        'blocked_revenue',
        'top_blocking_type'
      );

  return {
    revenueToday,
    revenueDeltaVsYesterday,
    collectedRevenue:
      opctl?.realized_revenue != null ? Number(opctl.realized_revenue) : null,
    atRiskRevenue:
      opctl?.at_risk_revenue != null ? Number(opctl.at_risk_revenue) : null,
    blockedRevenue:
      opctl?.blocked_revenue != null ? Number(opctl.blocked_revenue) : null,
    topBlockingType: opctl?.top_blocking_type ?? null,
    };
  });
}