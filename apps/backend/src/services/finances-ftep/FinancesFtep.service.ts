import type { FinancesFacts } from 'api-src/services/finances-facts/FinancesFacts.types';
import type { FinancesIntelligence } from 'api-src/services/finances-intelligence/FinancesIntelligence.service';
import type { FinancesFT2Exposure } from './FinancesFtep.types';

/**
 * Finances FTEP — Truth Exposure Policy
 * -----------------------------------
 * Downgrades intelligence into FT2-safe observability.
 *
 * Rules:
 * - Strip all sensitive intelligence
 * - No new meaning
 * - No thresholds
 * - Null when indeterminate
 */
export function buildFinancesFtep(input: {
  facts: FinancesFacts;
  intelligence: FinancesIntelligence;
}): FinancesFT2Exposure {
  const { facts, intelligence } = input;

  /**
   * Context — observational facts only
   */
  const context = {
    period: facts.period,
    revenueObserved: facts.totalRevenue,
    netObserved: facts.netResult,
  };

  /**
   * Temporal awareness (downgraded)
   * --------------------------------
   * No reasons, no thresholds exposed.
   * Only coarse states are allowed.
   */
  const timeAwareness:
    | {
        history: 'sufficient' | 'insufficient';
        confidence: 'high' | 'medium' | 'low' | 'unknown';
      }
    | null =
    intelligence.confidence.level === 'unknown'
      ? null
      : {
          history: intelligence.temporal.sufficientForTrend
            ? 'sufficient'
            : 'insufficient',

          confidence: intelligence.confidence.level,
        };

  /**
   * Blind spots (downgraded)
   * -----------------------
   * No causes. No instructions.
   */
  const blindSpots:
    | {
        costs: 'unknown' | 'known';
        refunds: 'unknown' | 'known';
        history: 'insufficient' | 'sufficient';
      }
    | null = {
      costs: intelligence.blindSpots.costsMissing
        ? 'unknown'
        : 'known',

      refunds: intelligence.blindSpots.refundsMissing
        ? 'unknown'
        : 'known',

      history: intelligence.blindSpots.historyInsufficient
        ? 'insufficient'
        : 'sufficient',
    };

  /**
   * Timeline exposure (safe)
   * ------------------------
   * Expose only revenueObserved.
   * No net. No trend. No math.
   */
  const timeline =
    facts.timeSeries?.points?.length > 0
      ? {
          bucket: 'day' as const,
          points: facts.timeSeries.points.map((p) => ({
            from: p.from,
            to: p.to,
            revenueObserved: p.revenueObserved,
          })),
        }
      : null;

  /**
   * Coverage continuity (safe)
   */
  const coverageTimeline =
    facts.timeSeries?.points?.length > 0
      ? {
          bucket: 'day' as const,
          points: facts.timeSeries.points.map((p) => ({
            from: p.from,
            to: p.to,
            coveragePct: p.coveragePct,
          })),
        }
      : null;

  /**
   * Decision safety (downgraded)
   */
  const decisionSafety =
    intelligence.decisionSafety.status === 'unknown'
      ? null
      : {
          status: intelligence.decisionSafety.status,
        };

  /**
   * Profit preconditions (downgraded)
   */
  const profitPreconditions =
    intelligence.profitPreconditions.decisionSafe &&
    intelligence.profitPreconditions.costsReady &&
    intelligence.profitPreconditions.historyReady
      ? { status: 'ready' as const }
      : { status: 'not_ready' as const };


  /**
   * If net status is unknown, suppress outcome and trend.
   */
  if (intelligence.netResult.status === 'unknown') {
    return {
      context,
      outcome: null,
      trend: null,
      dataCoverage: {
        completenessPct: facts.dataCoverage.completenessPct,
      },
      timeAwareness,
      timeline,
      coverageTimeline,
      blindSpots,
      decisionSafety,
      profitPreconditions,
    };
  }

  return {
    context,

    outcome: {
      status:
        intelligence.netResult.status === 'good'
          ? 'positive'
          : 'negative',
    },

    trend: intelligence.trend
      ? { direction: intelligence.trend.direction }
      : null,

    dataCoverage: {
      completenessPct: facts.dataCoverage.completenessPct,
    },

    timeAwareness,
    timeline,
    coverageTimeline,
    blindSpots,
    decisionSafety,
    profitPreconditions,
  };
}
