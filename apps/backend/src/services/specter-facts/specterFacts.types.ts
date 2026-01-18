//apps/backend/src/services/specter-facts/specterFacts.types.ts
export interface SpecterFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  /**
   * Total number of observed sessions in period.
   */
  sessionsObserved: number | null;

  /**
   * Count of sessions with exit intent.
   */
  exitIntentSessions: number | null;

  /**
   * Existence-only structural funnel marker.
   */
  funnelsDetected: boolean | null;

    /**
   * Existence-only depth signal.
   * True if at least one session has pageViewsCount > 1.
   *
   * Rules:
   * - null → no sessions
   * - true → multi-step behavior observed
   * - false → only single-step sessions observed
   */
  multiStepSessionsPresent: boolean | null;

  /**
   * Existence-only surface breadth signal.
   * True if at least one session touches multiple unique surfaces.
   *
   * Rules:
   * - null → no sessions or no breadth data
   * - true → surface exploration observed
   * - false → single-surface behavior only
   */
  surfaceBreadthPresent: boolean | null;

  /**
   * Existence-only returning behavior signal.
   * True if at least one returning session is observed.
   *
   * Rules:
   * - null → no sessions or no returning data
   * - true → returning behavior observed
   * - false → only first-time sessions observed
   */
  returningSessionsPresent: boolean | null;

  /**
   * Existence-only compound exit signal.
   * True if at least one session exited with no meaningful interaction.
   *
   * Rules:
   * - null  → no sessions or no pageViewsCount data
   * - true  → exitIntent === true AND pageViewsCount <= 1 observed
   * - false → sessions exist, none match
   */
  exitWithoutInteractionPresent: boolean | null;

  /**
   * Existence-only average depth proxy (FT2-safe).
   * Indicates meaningful session depth without aggregation.
   *
   * Rules:
   * - null  → no sessions OR pageViewsCount unavailable
   * - true  → at least one session has pageViewsCount >= 3
   * - false → sessions exist, but all sessions have pageViewsCount <= 2
   *
   * No averaging. No ratios. No inference.
   */
  averageSessionDepthPresent: boolean | null;

  extractedAt: string;
}


export interface GetSpecterFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}