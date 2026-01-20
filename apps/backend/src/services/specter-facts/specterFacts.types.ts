//apps/backend/src/services/specter-facts/specterFacts.types.ts

/**
     * ─────────────────────────────────────
     * Domain 10 — Instrumentation Gaps Reality
     * ─────────────────────────────────────
     *
     * Meaning:
     * Explicitly identifies which observability dimensions
     * are missing or not instrumented for the current period.
     *
     * Semantics:
     * - null  → instrumentation cannot be assessed
     * - []    → fully instrumented (within FT2 scope)
     * - array → specific missing dimensions
     *
     * Constraints:
     * - No inference
     * - No severity
     * - No recommendations
     *
     * This describes system visibility, not customer behavior.
     */  

export type InstrumentationGap =
  | 'sessions'
  | 'page_depth'
  | 'surface_breadth'
  | 'returning_flag'
  | 'exit_intent'
  | 'funnels';

export type InstrumentationGaps = InstrumentationGap[] | null;

/**
     * ─────────────────────────────────────
     * Domain 10 — Instrumentation Gaps Reality
     * ─────────────────────────────────────
     *
     * Meaning:
     * Explicitly identifies which observability dimensions
     * are missing or not instrumented for the current period.
     *
     * Semantics:
     * - null  → instrumentation cannot be assessed
     * - []    → fully instrumented (within FT2 scope)
     * - array → specific missing dimensions
     *
     * Constraints:
     * - No inference
     * - No severity
     * - No recommendations
     *
     * This describes system visibility, not customer behavior.
     */
 export type DataFreshness = boolean | null;


    /**
     * ─────────────────────────────────────
     * Domain 12 — Cross-Domain Consistency Reality
     * ─────────────────────────────────────
     *
     * Meaning:
     * Detects logical contradictions between independently
     * derived domain facts.
     *
     * Semantics:
     * - null  → consistency cannot be assessed
     * - []    → no contradictions detected
     * - array → explicit logical violations
     *
     * Constraints:
     * - No inference
     * - No prioritization
     * - No correction
     *
     * This flags impossibilities, not anomalies.
     */
  export type ConsistencyIssue =
    | 'activity_without_sessions'
    | 'structure_without_activity'
    | 'depth_without_sessions'
    | 'breadth_without_sessions'
    | 'returning_without_sessions'
    | 'exit_without_sessions'
    | 'funnels_without_sessions';

  export type ConsistencyIssues = ConsistencyIssue[] | null;

/**
 * Specter Facts
 * -------------
 * Deterministic extraction of raw, existence-only facts
 * from observed session data.
 *
 * HARD RULES:
 * - No intelligence or interpretation
 * - No aggregation beyond existence checks
 * - No ratios, percentages, or trends
 * - Nulls represent epistemic absence
 */

export interface SpecterFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  /**
   * ─────────────────────────────────────
   * Identity Presence Reality (Domain 1)
   * ─────────────────────────────────────
   *
   * Question:
   * Do customers exist as identifiable entities?
   *
   * HARD RULES:
   * - Existence-only
   * - No enrichment
   * - No validation
   * - null propagates aggressively
   */

  /**
   * customersPresent
   *
   * Rules:
   * - null  → customer table not observable / ingestion incomplete
   * - true  → ≥ 1 customer record exists
   * - false → explicitly zero customers
   */
  customersPresent: boolean | null;

  /**
   * identityCoverage
   *
   * Rules:
   * - 'complete' → all observable customers have identifiers
   * - 'partial'  → customers exist, identifiers missing on some
   * - 'unknown'  → cannot assess (schema / join / ingestion issue)
   *
   * NOTE:
   * This is a trust signal, not a quality score.
   */
  identityCoverage: 'complete' | 'partial' | 'unknown';

   /**
   * ─────────────────────────────────────
   * Activity Presence Reality (Domain 2)
   * ─────────────────────────────────────
   *
   * Question:
   * Is there any observable customer activity at all?
   *
   * HARD RULES:
   * - Existence-only
   * - No counts
   * - No ratios
   * - No inference
   * - Independent of identity
   *
   * This domain answers ONLY whether activity exists.
   * It does not describe quality, depth, or value.
   */

  /**
   * sessionsPresent
   *
   * Meaning:
   * - null  → activity cannot be observed (no sessions ingested / filtered out)
   * - true  → ≥ 1 session observed in the period
   * - false → explicitly zero sessions in the period
   *
   * NOTE:
   * - `false` is a strong signal (silence is observable)
   * - `null` means epistemic absence, not inactivity
   */
  sessionsPresent: boolean | null;

  /**
   * Existence-only exit intent signal.
   *
   * Rules:
   * - null  → no sessions OR exit intent not observable
   * - true  → at least one session expressed exit intent
   * - false → sessions exist, none expressed exit intent
   */
  exitIntentDetected: boolean | null;

  /**
   * Existence-only structural funnel marker.
   */
  funnelsDetected: boolean | null;

  /**
   * ─────────────────────────────────────
   * Engagement Structure Reality (Domain 3)
   * ─────────────────────────────────────
   *
   * Question:
   * Is customer behavior structurally meaningful?
   *
   * HARD RULES:
   * - Existence-only
   * - No aggregation
   * - No inference
   * - Independent of identity
   * - null propagates aggressively
   */

  /**
   * multiStepSessionsPresent
   *
   * Rules:
   * - null  → sessions not observable OR pageViewsCount unavailable
   * - true  → ≥ 1 session has pageViewsCount > 1
   * - false → sessions exist, all sessions are single-step
   */
  multiStepSessionsPresent: boolean | null;

  /**
   * averageSessionDepthPresent
   *
   * Rules:
   * - null  → sessions not observable OR pageViewsCount unavailable
   * - true  → ≥ 1 session has pageViewsCount >= 3
   * - false → sessions exist, all sessions have pageViewsCount <= 2
   *
   * NOTE:
   * This is a proxy signal. No averages are computed.
   */
  averageSessionDepthPresent: boolean | null;


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
   * ─────────────────────────────────────
   * Domain 10 — Instrumentation Gaps Reality
   * ─────────────────────────────────────
   */
  instrumentationGaps: InstrumentationGaps;

  /**
   * Domain 11 — Data Freshness Reality
   */
  dataFreshness: DataFreshness;

  consistencyIssues: ConsistencyIssues;

  extractedAt: string;
}

export interface GetSpecterFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}