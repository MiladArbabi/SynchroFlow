// apps/backend/src/services/specter-ftep/specterFtep.types.ts

export interface SpecterFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
    /**
     * Existence-only session observability.
     *
     * Rules:
     * - null  → no sessions observed / not observable
     * - true  → at least one session observed
     *
     * No magnitude. No counts.
     */
    sessionsPresent: boolean | null;
  };

  /**
   * Directional movement signal (FT2-safe).
   * - No magnitude
   * - No explanation
   * - May be 'unknown'
   */
  activityDirection:
    | 'up'
    | 'down'
    | 'flat'
    | 'unknown'
    | null;

  signals: {
    /**
     * Structural existence signals (FT2-safe).
     * No counts, no ratios, no inference.
     */
    exitIntentDetected: boolean | null;
    funnelsDetected: boolean | null;

    /**
     * Existence-only behavioral depth signal.
     */
    multiStepSessionsPresent: boolean | null;

    surfaceBreadthPresent: boolean | null;
    returningSessionsPresent: boolean | null;

    /**
     * Existence-only early exit signal.
     */
    exitWithoutInteractionPresent: boolean | null;

    /**
     * Existence-only average session depth proxy.
     */
    averageSessionDepthPresent: boolean | null;
  };

   /**
   * Observability coverage (FT2-safe).
   *
   * Meaning:
   * - 'complete'     → sessions are present
   * - 'insufficient' → explicitly no sessions
   * - null           → cannot determine
   *
   * Note:
   * - 'partial' is intentionally not emitted yet
   */
  dataCoverage:
    | 'complete'
    | 'insufficient'
    | null;
}