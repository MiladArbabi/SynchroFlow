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

type AnalyticsFt2Snapshot = {
  context?: {
    period?: {
      from: string;
      to: string;
    };
  };

  outcome?: {
    status: 'positive' | 'negative';
  } | null;

  trend?: {
    direction: 'unknown';
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
      period: snapshot.context?.period ?? { from: '', to: '' },
    },

    outcome:
      snapshot.outcome === undefined ? null : snapshot.outcome,

    trend:
      snapshot.trend === undefined ? null : snapshot.trend,
  };
}
