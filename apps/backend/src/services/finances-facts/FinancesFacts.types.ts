export interface FinancesFacts {
  shopId: number;

  /**
   * Observation window for this snapshot.
   * All facts (including time series) are strictly scoped to this range.
   */
  period: {
    from: string;
    to: string;
  };

  /**
   * Aggregate facts (snapshot-level)
   * --------------------------------
   * These represent raw sums over the full period.
   * No interpretation is applied.
   */
  totalRevenue: number | null;
  totalCosts: number | null;
  netResult: number | null;

  /**
   * Data coverage (snapshot-level)
   * ------------------------------
   * Answers only: "Did we observe any canonical orders at all?"
   */
  dataCoverage: {
    completenessPct: number | null;
  };

  /**
   * Time-series facts (bucketed)
   * ----------------------------
   * Raw, interpretation-free financial observations
   * within the selected period.
   *
   * IMPORTANT:
   * - Buckets do NOT imply trends
   * - Missing data MUST be null (never zero)
   * - Buckets are deterministic UTC ranges
   */
  timeSeries: {
    bucket: 'day';
    points: Array<{
      from: string;
      to: string;

      revenueObserved: number | null;
      ordersCount: number | null;

      /**
       * Coverage answers:
       * "Did we observe ≥1 canonical order in this bucket?"
       *
       * - null → no evidence
       * - 100  → evidence present
       */
      coveragePct: number | null;
    }>;
  };

  /**
   * Extraction timestamp for observability/debugging only.
   */
  extractedAt: string;

  /**
   * Refunds observed (aggregate)
   * ----------------------------
   * Absolute sum of observed refunds in the period.
   *
   * - null → no refund evidence exists
   * - 0    → refunds observed but net to zero
   *
   * No assumptions about materiality.
   */
  refundsObserved: number | null;

  /**
   * Orders observed (aggregate)
   * ---------------------------
   * Total number of canonical orders in the period.
   *
   * - null → no evidence
   */
  ordersCount: number | null;
}