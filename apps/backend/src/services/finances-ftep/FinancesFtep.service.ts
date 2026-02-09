/**
 * NOTE — EPISTEMIC BOUNDARY
 * --------------------------------
 * Finances does NOT yet produce EpistemicValue inputs.
 * Decision safety here is intelligence-based only.
 *
 * Epistemic decision gating is FORBIDDEN
 * until finances facts emit EpistemicValue<T>.
 */

import type { FinancesFacts } from 'api-src/services/finances-facts/FinancesFacts.types';
import type { FinancesIntelligence } from 'api-src/services/finances-intelligence/FinancesIntelligence.service';
import type { FinancesFT2Exposure } from './FinancesFtep.types';
import { decisionEpistemicGate } from '../epistemic/decisionEpistemicGate';
import type { EpistemicValue } from '@lasyncro/epistemic';

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
  epistemic?: {
    revenue?: EpistemicValue<number>;
    netResult?: EpistemicValue<number>;
  };
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
   * Decision Safety — Epistemic Gate (Phase 14)
   * ------------------------------------------
   * Rules:
   * - Intelligence decides ONLY if epistemic knowledge allows
   * - UNKNOWN or INCOMPLETE epistemic state blocks decisions
   * - Missing epistemic inputs preserve legacy behavior
   */

  let decisionSafety = {
    status: intelligence.decisionSafety.status,
  };

  const epistemicInputs = [
    input.epistemic?.revenue,
    input.epistemic?.netResult,
  ].filter(Boolean) as EpistemicValue<any>[];

  if (epistemicInputs.length > 0) {
    const gate = decisionEpistemicGate(epistemicInputs);

    decisionSafety = {
      status: gate.allowed
        ? intelligence.decisionSafety.status
        : 'unknown',
    };
  }

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
   * Cost reality (FT2-safe)
   * ----------------------
   * Coarse visibility only.
   * No coverage %, no explanations.
   */
  const costReality =
    intelligence.costReality.status === 'unknown'
      ? null
      : {
          status: intelligence.costReality.status,
        };

  /**
   * Refund reality (downgraded)
   */
  const refundReality =
    intelligence.refundReality.status === 'unknown'
      ? { status: 'unknown' as const }
      : { status: 'known' as const };

  /**
   * Refund impact (FT2-safe)
   * -----------------------
   * Directional only.
   * No magnitude exposed.
   */
  const refundImpact =
    intelligence.refundImpact.status === 'unknown'
      ? null
      : {
          status: intelligence.refundImpact.status,
        };

  /**
   * Financial consistency (FT2-safe)
   * --------------------------------
   * Stability signal without trend or growth.
   */
  const financialConsistency =
    intelligence.financialConsistency.status === 'unknown'
      ? null
      : {
          status: intelligence.financialConsistency.status,
        };

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
      refundReality,
      costReality,
      refundImpact,
      financialConsistency,
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
    costReality,
    refundReality,
    refundImpact,
    financialConsistency,
  };
}
