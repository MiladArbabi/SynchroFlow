export interface FinancesFT2Exposure {
  /**
   * Observed financial context (facts only)
   */
  context: {
    period: {
      from: string;
      to: string;
    };
    revenueObserved: number | null;
    netObserved: number | null;
  };

  /**
   * Directional outcome (downgraded intelligence)
   */
  outcome:
    | {
        status: 'positive' | 'negative' | 'unknown';
      }
    | null;

  /**
   * Trend direction (may be null or 'unknown')
   */
  trend:
    | {
        direction: 'up' | 'down' | 'flat' | 'unknown';
      }
    | null;

  /**
   * Evidence signal
   */
  dataCoverage: {
    completenessPct: number | null;
  };

  /**
   * Temporal awareness (coarsened)
   * ------------------------------
   * Answers only:
   * - Do we have enough history?
   * - How confident is the system in what it knows?
   */
  timeAwareness:
    | {
        history: 'sufficient' | 'insufficient';
        confidence: 'high' | 'medium' | 'low' | 'unknown';
      }
    | null;

     /**
   * Time series (observational only)
   * --------------------------------
   * Raw, bucketed observations.
   * No interpretation. No guarantees.
   */
  timeline:
    | {
        bucket: 'day';
        points: Array<{
          from: string;
          to: string;
          revenueObserved: number | null;
        }>;
      }
    | null;

  /**
   * Coverage continuity (observational only)
   */
  coverageTimeline:
    | {
        bucket: 'day';
        points: Array<{
          from: string;
          to: string;
          coveragePct: number | null;
        }>;
      }
    | null;

  /**
   * Blind spots (observational)
   * ---------------------------
   * Explicitly shows what is unknown.
   */
  blindSpots:
    | {
        costs: 'unknown' | 'known';
        refunds: 'unknown' | 'known';
        history: 'insufficient' | 'sufficient';
      }
    | null;

  /**
   * Decision safety (FT2-safe)
   * -------------------------
   * Coarse, directional, non-explanatory.
   */
  decisionSafety:
    | {
        status: 'safe' | 'unsafe' | 'unknown';
      }
    | null;

  /**
   * Profit preconditions (FT2-safe)
   * ------------------------------
   * Shows whether profit is a valid signal yet.
   */
  profitPreconditions:
    | {
        status: 'ready' | 'not_ready';
      }
    | null;

  /**
   * Refund reality (FT2-safe)
   * ------------------------
   * States only whether refunds are observable.
   */
  refundReality:
    | {
        status: 'known' | 'unknown';
      }
    | null;

  /**
   * Cost reality (FT2-safe)
   */
  costReality:
    | {
        status: 'known' | 'partial' | 'unknown';
      }
    | null;

  /**
   * Refund impact (FT2-safe)
   */
  refundImpact:
    | {
        status: 'material' | 'immaterial' | 'unknown';
      }
    | null;

  /**
   * Financial consistency (FT2-safe)
   */
  financialConsistency:
    | {
        status: 'stable' | 'volatile' | 'unknown';
      }
    | null;
}