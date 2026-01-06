/**
 * AnalyticsModuleFT2Props
 * ======================
 *
 * FT2 Observability Contract for Analytics / InsightCore.
 *
 * This contract is intentionally:
 * - Read-only
 * - Non-inferential
 * - Shape-stable
 * - Semantically boring
 *
 * ❗ IMPORTANT
 * ------------
 * FT2 is NOT intelligence.
 * FT2 is NOT explanation.
 * FT2 is NOT InsightCore v1+.
 *
 * This surface answers ONLY:
 *   "Is data present, is it stable, and is it changing?"
 *
 * Anything that explains *why*, predicts *what happens next*,
 * or suggests *what to do* is STRICTLY OUT OF SCOPE.
 */

export interface AnalyticsModuleFT2Props {
  /**
   * Context
   * -------
   * Temporal and scope framing for the snapshot.
   * No interpretation is allowed here.
   */
  context: {
    /**
     * Observed period for the snapshot.
     * Owned by backend.
     */
    period: {
      from: string;
      to: string;
    };

    /**
     * Total number of signals observed across modules
     * during the period.
     *
     * This is a COUNT ONLY.
     * No meaning, no weighting, no quality judgment.
     */
    signalsObserved: number | null;
  };

  /**
   * System Status
   * -------------
   * High-level observed system state.
   *
   * This is NOT an explanation.
   * This is NOT a diagnosis.
   *
   * It is a coarse, backend-owned label
   * describing the observed state of data coherence.
   */
  systemStatus: {
    /**
     * Observed state label.
     *
     * - healthy: data present and consistent
     * - degraded: partial or inconsistent data
     * - unknown: insufficient information
     */
    state: 'healthy' | 'degraded' | 'unknown';

    /**
     * Reliability of the status label itself.
     *
     * This is NOT confidence in outcomes.
     * This is reliability of observation only.
     */
    reliability: 'high' | 'medium' | 'low';
  } | null;

  /**
   * Stability Indicator
   * -------------------
   * Observed stability of metrics across the period.
   *
   * No magnitude explanation.
   * No causal reasoning.
   */
  stabilityIndicator: {
    /**
     * Observed stability label.
     */
    state: 'stable' | 'unstable' | 'unknown';
  } | null;

  /**
   * Data Coverage
   * -------------
   * Visibility into which domains are missing or incomplete.
   *
   * This does NOT explain impact.
   * This does NOT assign blame.
   */
  dataCoverage: Array<{
    /**
     * Domain with incomplete or missing data.
     */
    domain:
      | 'orders'
      | 'finances'
      | 'products'
      | 'customers'
      | 'unknown';

    /**
     * Coverage state for the domain.
     */
    status: 'complete' | 'partial' | 'missing';
  }> | null;

  /**
   * Trend Signal
   * ------------
   * Direction-only temporal observation.
   *
   * No magnitude.
   * No explanation.
   */
  trendSignal: {
    /**
     * Observed directional trend.
     */
    direction: 'up' | 'down' | 'flat' | 'unknown';

    /**
     * Optional comparison window.
     * Used only for labeling.
     */
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
}