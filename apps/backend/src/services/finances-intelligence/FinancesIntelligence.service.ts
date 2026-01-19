import type { FinancesFacts } from 'api-src/services/finances-facts/FinancesFacts.types';

export type FinancesStatus = 'good' | 'bad' | 'unknown';
export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface FinancesIntelligence {
  /**
   * Snapshot-level classification
   */
  netResult: {
    value: number | null;
    status: FinancesStatus;
  };

  /**
   * Trend direction (may remain 'unknown')
   * Direction is NOT guaranteed to be meaningful.
   */
  trend: {
    direction: TrendDirection;
  };

  /**
   * Snapshot-level data coverage
   */
  dataCoveragePct: number | null;

  /**
   * Temporal sufficiency (internal only)
   * -----------------------------------
   * Answers: "Do we have enough structured history
   * to safely speak about time?"
   */
  temporal: {
    bucketsObserved: number;
    continuity: 'complete' | 'partial' | 'sparse';
    sufficientForTrend: boolean;
  };

  /**
   * Confidence classification (internal only)
   * -----------------------------------------
   * Confidence is about *knowing*, not *results*.
   */
  confidence: {
    level: 'high' | 'medium' | 'low' | 'unknown';
  };

  /**
   * INTERNAL ONLY — MUST NEVER LEAK
   */
  marginPct: number | null;
  lossReason: string | null;

  /**
   * Blind spots (internal only)
   * --------------------------
   * Explicit classification of what is NOT known.
   */
  blindSpots: {
    costsMissing: boolean;
    refundsMissing: boolean;
    historyInsufficient: boolean;
  };

  /**
   * Decision safety (internal only)
   * -------------------------------
   * Answers: "Is acting on this data risky?"
   */
  decisionSafety: {
    status: 'safe' | 'unsafe' | 'unknown';
  };

    /**
   * Profit preconditions (internal only)
   * -----------------------------------
   * Answers: "Is profit even a valid concept yet?"
   */
  profitPreconditions: {
    costsReady: boolean;
    refundsReady: boolean;
    historyReady: boolean;
    decisionSafe: boolean;
  };

  /**
   * Refund reality (internal only)
   * -----------------------------
   * Answers: "Do we have refund facts at all?"
   */
  refundReality: {
    status: 'known' | 'unknown';
  };

  /**
   * Cost reality (internal only)
   * ---------------------------
   * Answers: "Do we actually know costs well enough?"
   */
  costReality: {
    status: 'known' | 'partial' | 'unknown';
  };

  /**
   * Refund impact (internal only)
   * ----------------------------
   * Answers: "Do refunds materially affect interpretation?"
   */
  refundImpact: {
    status: 'material' | 'immaterial' | 'unknown';
  };

  /**
   * Financial consistency (internal only)
   * ------------------------------------
   * Answers: "Is activity stable enough to reason about?"
   */
  financialConsistency: {
    status: 'stable' | 'volatile' | 'unknown';
  };
}


/**
 * Finances Intelligence Service
 * ----------------------------
 * Converts raw financial facts into classified meaning.
 *
 * Rules:
 * - NO database access
 * - NO UI semantics
 * - NO explanations
 * - NO exposure guarantees
 *
 * Intelligence may decide.
 * Intelligence may NOT speak.
 */
export function buildFinancesIntelligence(
  facts: FinancesFacts
): FinancesIntelligence {
  const {
    totalRevenue,
    totalCosts,
    netResult,
    dataCoverage,
    timeSeries,
  } = facts;

  /**
   * Net result status (snapshot-level)
   */
  let status: FinancesStatus = 'unknown';

  if (netResult != null) {
    status = netResult >= 0 ? 'good' : 'bad';
  }

  /**
   * Temporal analysis (NO trends)
   * -----------------------------
   * We only classify whether time-based reasoning
   * is allowed to exist later.
   */
  const points = timeSeries?.points ?? [];
  const bucketsObserved = points.length;

  let continuity: 'complete' | 'partial' | 'sparse' = 'sparse';

  if (bucketsObserved >= 14) {
    continuity = 'complete';
  } else if (bucketsObserved >= 5) {
    continuity = 'partial';
  }

  const sufficientForTrend =
    continuity === 'complete' &&
    dataCoverage.completenessPct === 100;

  /**
   * Confidence classification
   * -------------------------
   * Confidence reflects evidence strength,
   * not business performance.
   */
  let confidenceLevel: 'high' | 'medium' | 'low' | 'unknown' =
    'unknown';

  if (dataCoverage.completenessPct === 100) {
    if (sufficientForTrend) {
      confidenceLevel = 'high';
    } else if (bucketsObserved >= 5) {
      confidenceLevel = 'medium';
    } else {
      confidenceLevel = 'low';
    }
  }

  /**
   * Blind spot classification
   * -------------------------
   * This is about absence, not failure.
   */
  const blindSpots = {
    costsMissing: facts.totalCosts == null,
    refundsMissing: true, // refunds ingestion not implemented yet
    historyInsufficient: !sufficientForTrend,
  };

    /**
   * Decision safety classification
   * ------------------------------
   * Conservative by design.
   */
  let decisionSafety: 'safe' | 'unsafe' | 'unknown' = 'unknown';

  if (
    dataCoverage.completenessPct === 100 &&
    !blindSpots.costsMissing &&
    !blindSpots.historyInsufficient
  ) {
    decisionSafety = 'safe';
  } else if (
    blindSpots.costsMissing ||
    blindSpots.historyInsufficient
  ) {
    decisionSafety = 'unsafe';
  }

  /**
   * Profit preconditions
   * --------------------
   * Pure gating logic. No interpretation.
   */
  const profitPreconditions = {
    costsReady: !blindSpots.costsMissing,
    refundsReady: !blindSpots.refundsMissing,
    historyReady: !blindSpots.historyInsufficient,
    decisionSafe: decisionSafety === 'safe',
  };

  /**
   * Refund reality
   * --------------
   * Refund ingestion is not implemented yet,
   * therefore refunds are currently unknown.
   */
  const refundReality: FinancesIntelligence['refundReality'] = {
    status: blindSpots.refundsMissing ? 'unknown' : 'known',
  };

  /**
   * Cost reality
   * ------------
   * No assumptions. Pure availability check.
   */
  const costReality: FinancesIntelligence['costReality'] = {
    status:
      facts.totalCosts == null
        ? 'unknown'
        : 'known',
  };

  /**
   * Refund impact
   * -------------
   * No percentages. No thresholds exposed.
   */
  const refundImpact: FinancesIntelligence['refundImpact'] = {
    status:
      facts.refundsObserved == null
        ? 'unknown'
        : facts.refundsObserved > 0
          ? 'material'
          : 'immaterial',
        };

  /**
   * Financial consistency
   * ---------------------
   * Stability without direction.
   */
  const financialConsistency: FinancesIntelligence['financialConsistency'] =
    bucketsObserved < 5
      ? { status: 'unknown' }
      : {
          status:
            points.some(p => p.revenueObserved == null)
              ? 'volatile'
              : 'stable',
          };

  /**
   * Trend direction
   * ----------------
   * Explicitly unknown unless later unlocked.
   */
  const trendDirection: TrendDirection = 'unknown';

  /**
   * Margin (internal only)
   */
  const marginPct =
    totalRevenue == null || totalRevenue === 0 || netResult == null
      ? null
      : (netResult / totalRevenue) * 100;

  /**
   * Loss reason (placeholder, internal only)
   */
  const lossReason =
    netResult != null && netResult < 0 ? 'net_negative' : null;

  return {
    netResult: {
      value: netResult,
      status,
    },

    trend: {
      direction: trendDirection,
    },

    dataCoveragePct: dataCoverage.completenessPct,

    temporal: {
      bucketsObserved,
      continuity,
      sufficientForTrend,
    },

    confidence: {
      level: confidenceLevel,
    },

    marginPct,
    lossReason,
    blindSpots,

    decisionSafety: {
      status: decisionSafety,
    },
    profitPreconditions,
    refundReality,

    costReality,
    refundImpact,
    financialConsistency,
  };
}

