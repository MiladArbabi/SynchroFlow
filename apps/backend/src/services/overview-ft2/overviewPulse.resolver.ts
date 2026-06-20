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
  /** Today's gross revenue (revenue_projection_daily, latest date). */
  revenueToday: number | null;
  /** Delta vs the prior day's gross revenue. Null if no prior day. */
  revenueDeltaVsYesterday: number | null;
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
  // --- Financial anchor: today + yesterday gross revenue ---
  const revenueRows = await db('revenue_projection_daily')
    .where({ shop_id: shopId })
    .orderBy('revenue_date', 'desc')
    .limit(2)
    .select('revenue_date', 'gross_revenue');

  const revenueToday =
    revenueRows[0]?.gross_revenue != null
      ? Number(revenueRows[0].gross_revenue)
      : null;
  const revenueYesterday =
    revenueRows[1]?.gross_revenue != null
      ? Number(revenueRows[1].gross_revenue)
      : null;
  const revenueDeltaVsYesterday =
    revenueToday != null && revenueYesterday != null
      ? revenueToday - revenueYesterday
      : null;

  // --- Operational revenue control: latest snapshot_date row ---
  const opctl = await db('orders_operational_control_snapshot')
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
}