/**
 * AnalyticsModuleFT2Props
 * ======================
 *
 * Canonical FT2 UI contract for Analytics.
 *
 * Design rules (LOCKED):
 * - Shape-stable
 * - Read-only
 * - No intelligence
 * - Uncertainty expressed ONLY via `null`
 *
 * This contract MUST match:
 * - Backend AnalyticsFT2Exposure
 * - FT2 adapter output
 */

export interface AnalyticsModuleFT2Props {
  context: {
    period: {
      from: string;
      to: string;
    };
  };

  outcome: {
    status: 'positive' | 'negative';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;
}
