/**
 * "Needs a decision" header summary for the decisionCount > 0 case.
 *
 * Depends ONLY on the decision count — no blocked-revenue figure, no currency.
 *   1 → "1 decision pending. Review the issues below."
 *   2 → "2 decisions pending. Review the issues below."
 */
export declare function buildDecisionPendingSummary(decisionCount: number): string;
/**
 * Short label naming what a signal's revenueImpact figure represents, keyed
 * strictly by the signal's alertType (never inferred from id / deepLink /
 * title / module).
 *
 *   'sla_breach'      → "order value"
 *   'revenue_at_risk' → "blocked revenue"
 *   anything else      → null (figure renders bare)
 */
export declare function revenueImpactLabel(alertType: string | undefined): string | null;
