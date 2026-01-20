export interface CustomersFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };

    /**
     * ─────────────────────────────────────
     * Domain 1 — Identity Presence Reality
     * ─────────────────────────────────────
     */
    customersPresent: boolean | null;

    /**
     * Identity observability trust signal.
     */
    identityCoverage: 'complete' | 'partial' | 'unknown';

    /**
     * ─────────────────────────────────────
     * Domain 2 — Activity Presence Reality
     * ─────────────────────────────────────
     *
     * Customers activity ≠ sessions.
     * This answers only whether customers exist in-period.
     */
    activityObserved: boolean | null;
  };

  /**
   * Coarse engagement outcome.
   * Downgraded from intelligence.
   */
  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  /**
   * Direction is not available in Customers FT2.
   * Must remain unknown when exposed.
   */
  trend: {
    direction: 'unknown';
  } | null;
};