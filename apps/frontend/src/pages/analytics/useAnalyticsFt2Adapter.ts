// apps/frontend/src/pages/analytics/useAnalyticsFt2Adapter.ts

import type { AnalyticsModuleFT2Props } from '@lasyncro/analytics';

type AnalyticsFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  signalsAnalyzed?: number | null;

  coherenceSignal?: {
    state: 'coherent' | 'fragmented' | 'contradictory' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
  } | null;

  volatilitySignal?: {
    level: 'stable' | 'volatile' | 'chaotic' | 'unknown';
    variancePct?: number | null;
  } | null;

  blindSpots?: Array<{
    domain: 'orders' | 'finances' | 'products' | 'customers' | 'unknown';
    description: string;
    confidence: 'high' | 'medium' | 'low';
  }> | null;

  timeSignal?: {
    trend:
      | 'improving'
      | 'deteriorating'
      | 'stable'
      | 'volatile'
      | 'unknown';
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
};

/**
 * FT2 Analytics Adapter
 * --------------------
 * Pure mapping from backend snapshot → AnalyticsModuleFT2Props
 *
 * Invariants:
 * - No inference
 * - No lifecycle
 * - Undefined → null
 * - Null preserved
 * - Shape-stable
 */
export function mapAnalyticsFt2Props(
  snapshot: AnalyticsFt2Snapshot
): AnalyticsModuleFT2Props {
  return {
    context: {
      period: snapshot.period ?? { from: '', to: '' },
      signalsAnalyzed:
        snapshot.signalsAnalyzed === undefined
          ? null
          : snapshot.signalsAnalyzed,
    },

    coherenceSignal:
      snapshot.coherenceSignal === undefined
        ? null
        : snapshot.coherenceSignal,

    volatilitySignal:
      snapshot.volatilitySignal == null
        ? null
        : {
            level: snapshot.volatilitySignal.level,
            variancePct:
              snapshot.volatilitySignal.variancePct === undefined
                ? null
                : snapshot.volatilitySignal.variancePct,
          },

    blindSpots:
      snapshot.blindSpots == null
        ? null
        : snapshot.blindSpots.map((b) => ({
            domain: b.domain,
            description: b.description,
            confidence: b.confidence,
          })),

    timeSignal:
      snapshot.timeSignal === undefined ? null : snapshot.timeSignal,
  };
}