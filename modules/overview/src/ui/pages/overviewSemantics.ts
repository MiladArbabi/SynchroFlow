// modules/overview/src/ui/pages/overviewSemantics.ts
//
// OVERVIEW SEMANTIC SEAM (OV-DATA-02 — OV-SEM correction)
// ------------------------------------------------------
// Pure, dependency-free string helpers for the "Needs a decision" header
// summary and the per-signal revenue-impact label.
//
// ZERO imports — no React, no @lasyncro/shared/ui, no module barrel.

/**
 * "Needs a decision" header summary for the decisionCount > 0 case.
 *
 * Depends ONLY on the decision count — no blocked-revenue figure, no currency.
 *   1 → "1 decision pending. Review the issues below."
 *   2 → "2 decisions pending. Review the issues below."
 */
export function buildDecisionPendingSummary(decisionCount: number): string {
  return `${decisionCount} decision${decisionCount !== 1 ? 's' : ''} pending. Review the issues below.`;
}

/**
 * Short label naming what a signal's revenueImpact figure represents, keyed
 * strictly by the signal's alertType (never inferred from id / deepLink /
 * title / module).
 *
 *   'sla_breach'      → "order value"
 *   'revenue_at_risk' → "blocked revenue"
 *   anything else      → null (figure renders bare)
 */
export function revenueImpactLabel(alertType: string | undefined): string | null {
  switch (alertType) {
    case 'sla_breach':
      return 'order value';
    case 'revenue_at_risk':
      return 'blocked revenue';
    default:
      return null;
  }
}
