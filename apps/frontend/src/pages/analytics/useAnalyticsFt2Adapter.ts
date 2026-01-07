/**
 * FT2 Analytics Adapter
 * ====================
 *
 * Purpose:
 * --------
 * Pure mapping layer from backend snapshot → AnalyticsModuleFT2Props.
 *
 * This adapter is a **dumb pipe**.
 * It MUST NOT:
 * - Infer meaning
 * - Reinterpret enums
 * - Compute values
 * - Default data
 *
 * FT2 Invariants (LOCKED):
 * -----------------------
 * - No inference
 * - No defaults
 * - Undefined → null
 * - Null preserved
 * - Shape-stable output
 *
 * If you feel tempted to "improve" data here,
 * you are violating FT2 doctrine.
 */

import type { AnalyticsModuleFT2Props } from '@lasyncro/analytics';

/**
 * Backend snapshot shape for Analytics FT2.
 *
 * NOTE:
 * -----
 * This snapshot is intentionally flat and boring.
 * Any intelligence belongs upstream.
 */
type AnalyticsFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  signalsObserved?: number | null;

  systemStatus?: {
    state: 'healthy' | 'degraded' | 'unknown';
    reliability: 'high' | 'medium' | 'low';
  } | null;

  stabilityIndicator?: {
    state: 'stable' | 'unstable' | 'unknown';
  } | null;

  dataCoverage?: Array<{
    domain:
      | 'orders'
      | 'finances'
      | 'products'
      | 'customers'
      | 'unknown';
    status: 'complete' | 'partial' | 'missing';
  }> | null;

  trendSignal?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
};

/**
 * mapAnalyticsFt2Props
 * -------------------
 * Canonical FT2 adapter function.
 *
 * This function is intentionally repetitive.
 * Clarity > cleverness.
 */
export function mapAnalyticsFt2Props(
  snapshot: AnalyticsFt2Snapshot
): AnalyticsModuleFT2Props {
  return {
    context: {
      period: snapshot.period ?? { from: '', to: '' },

      signalsObserved:
        snapshot.signalsObserved === undefined
          ? null
          : snapshot.signalsObserved,
    },

    systemStatus:
      snapshot.systemStatus === undefined
        ? null
        : snapshot.systemStatus,

    stabilityIndicator:
      snapshot.stabilityIndicator === undefined
        ? null
        : snapshot.stabilityIndicator,

    dataCoverage:
      snapshot.dataCoverage == null
        ? null
        : snapshot.dataCoverage.map((c) => ({
            domain: c.domain,
            status: c.status,
          })),

    trendSignal:
      snapshot.trendSignal === undefined
        ? null
        : snapshot.trendSignal,
  };
}