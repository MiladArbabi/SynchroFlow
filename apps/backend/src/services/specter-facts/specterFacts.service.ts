//apps/backend/src/services/specter-facts/specterFacts.service.ts
import { ConsistencyIssue, ConsistencyIssues, GetSpecterFactsInput, InstrumentationGap, InstrumentationGaps, SpecterFacts } from './specterFacts.types';
import { createSessionStore } from 'modules-specter/store/session-store';

/**
 * Specter Facts
 * -------------
 * Raw, interpretation-free extraction of session facts.
 *
 * HARD RULES:
 * - No intelligence
 * - No percentages
 * - No trends
 * - Preserve nulls
 */
// apps/backend/src/services/specter-facts/specterFacts.service.ts

export async function getSpecterFacts(
  input: GetSpecterFactsInput
): Promise<SpecterFacts> {
  const { shopId, period } = input;
  const sessionStore = createSessionStore();

  /**
   * ─────────────────────────────────────
   * Domain 1 — Identity Presence Reality
   * ─────────────────────────────────────
   *
   * CURRENT STATE:
   * - Specter ingests anonymous sessions only
   * - No customer entity store exists
   * - No identity joins are possible
   *
   * Therefore:
   * - Identity existence is NOT observable
   * - Coverage cannot be assessed
   *
   * This is an intentional downgrade, not a missing feature.
   */
  const customersPresent: boolean | null = null;
  const identityCoverage: 'unknown' = 'unknown';

  // Domain 2 — Activity Presence Reality
  // No sessions are observable for this shop or period.
  // Absence here is epistemic, not behavioral.
  const allSessions = sessionStore.getAllSessionsForShop(shopId);

  if (!allSessions || allSessions.length === 0) {
    return {
      shopId,
      period,

      customersPresent,
      identityCoverage,
      sessionsPresent: null,
      exitIntentDetected: null,
      funnelsDetected: null,
      multiStepSessionsPresent: null,
      surfaceBreadthPresent: null,
      returningSessionsPresent: null,
      exitWithoutInteractionPresent: null,
      averageSessionDepthPresent: null,

      instrumentationGaps: null,

      dataFreshness: null,

      consistencyIssues: null,

      extractedAt: new Date().toISOString()
    };
  }

  const fromTs = Date.parse(period.from);
  const toTs = Date.parse(period.to);

  const sessionsInPeriod = allSessions.filter((s: any) => {
    if (!s.createdAt) return false;
    const createdTs = Date.parse(s.createdAt);
    return createdTs >= fromTs && createdTs <= toTs;
  });

  if (sessionsInPeriod.length === 0) {
    return {
      shopId,
      period,
      customersPresent,
      identityCoverage,
      sessionsPresent: null,
      exitIntentDetected: null,
      funnelsDetected: null,
      multiStepSessionsPresent: null,
      surfaceBreadthPresent: null,
      returningSessionsPresent: null,
      exitWithoutInteractionPresent: null,
      averageSessionDepthPresent: null,

      instrumentationGaps: null,
      dataFreshness: null,
      consistencyIssues: null,
      
      extractedAt: new Date().toISOString()
    };
  }

    /**
     * DOMAIN 1 & 2 — Activity & Identity Presence Reality
     * 
     * Are customers doing anything at all?
     *
     * No magnitude, no weighting, no correction.
     */
    const sessionsPresent = sessionsInPeriod.length > 0;

    /**
     * Domain 3 — Engagement Structure Reality
     *
     * Purpose:
     * Detects whether any structurally meaningful behavior exists.
     *
     * Constraints:
     * - Existence-only
     * - No aggregation
     * - No inference
     * - Null propagates when depth data is unavailable
     */
    const hasDepthData = sessionsInPeriod.some(
      s => typeof s.pageViewsCount === 'number'
    );

    const multiStepSessionsPresent = !hasDepthData
      ? null
      : sessionsInPeriod.some(
          s => typeof s.pageViewsCount === 'number' && s.pageViewsCount > 1
        );

    const averageSessionDepthPresent = !hasDepthData
      ? null
      : sessionsInPeriod.some(
          s => typeof s.pageViewsCount === 'number' && s.pageViewsCount >= 3
        );

    /**
     * Domain 4 — Surface Breadth Reality
     * 
     * Do customers explore more than one surface?
     *
     * Rules:
     * - true  → at least one session has uniquePathsCount > 1
     * - false → sessions exist, but all are single-surface
     * - null  → no sessions or no uniquePathsCount data
     *
     * No inference. No aggregation.
     */
    // Guard: surface breadth observability
      const hasBreadthData = sessionsInPeriod.some(
        s => typeof s.uniquePathsCount === 'number'
      );

      const surfaceBreadthPresent = !hasBreadthData
        ? null
        : sessionsInPeriod.some(
            s =>
              typeof s.uniquePathsCount === 'number' &&
              s.uniquePathsCount > 1
          );

    /**
     * DOMAIN 5 — Returning Behavior Reality
     * 
     * Do customers come back?
     *
     * Rules:
     * - true  → at least one returning session observed
     * - false → sessions exist, none are returning
     * - null  → no sessions or no returning flag data
     * 
     * * Note:
     * Returning is session-scoped, not identity-scoped.
     * No identity. No correlation.
     */
    const hasReturningData = sessionsInPeriod.some(
      s => typeof s.isReturningSession === 'boolean'
    );

    const returningSessionsPresent = !hasReturningData
      ? null
      : sessionsInPeriod.some(s => s.isReturningSession === true);

    /**
     * DOMAIN 6 — Exit & Abandonment Reality
     * -----------------------------
     * Do customers leave without engaging?
     *
     * Rules:
     * - null  → no sessions OR pageViewsCount unavailable
     * - true  → at least one session exited with <= 1 page view
     * - false → sessions exist, none match condition
     */
    const exitWithoutInteractionPresent = !hasDepthData
      ? null
      : sessionsInPeriod.some(
          s =>
            s.exitIntent === true &&
            typeof s.pageViewsCount === 'number' &&
            s.pageViewsCount <= 1
        );

    /**
     * Domain 7 — Journey Structure (funnelsDetected)
     * ----------------
     * Is there any observable journey structure at all?
     *
     * Rules:
     * - true  → at least one session exposes a funnel marker
     * - false → sessions exist, but no funnel markers present
     * - null  → no sessions (handled above)
     *
     * No inference. No aggregation. No intelligence.
     */
      const funnelsDetected = sessionsInPeriod.some(
        s => s.funnelDetected === true
      );

    /**
     * Domain 8 — Exit Intent Reality
     *
     * Do customers express intent to leave?
     *
     * Existence-only behavioral signal.
     * NOT coverage. NOT quality. NOT severity.
     */
      const hasExitIntentData = sessionsInPeriod.some(
        s => typeof s.exitIntent === 'boolean'
      );

      const exitIntentDetected = !hasExitIntentData
        ? null
        : sessionsInPeriod.some(s => s.exitIntent === true);

    /**
     * Domain 10 — Instrumentation Gaps
     *
     * Meta-observability signal.
     *
     * HARD RULE:
     * A gap MUST be emitted only when the signal is referenced
     * elsewhere in Facts but not observable here.
     */
    const instrumentationGaps: InstrumentationGaps = [
      !hasDepthData && 'page_depth',
      !hasBreadthData && 'surface_breadth',
      !hasExitIntentData && 'exit_intent',
      !hasReturningData && 'returning_flag',
      !sessionsInPeriod.some(s => 'funnelDetected' in s) && 'funnels',
    ].filter(Boolean) as InstrumentationGap[];

    const extractedAt = new Date();
    const windowEnd = new Date(period.to);

    /**
     * Domain 11 — Data Freshness Reality
     *
     * Evaluated strictly against the observation window end.
     * This does NOT indicate ingestion health or latency.
     */
    const dataFreshness =
      !windowEnd || !extractedAt
        ? null
        : extractedAt >= windowEnd;

    /**
     * Domain 12 — Cross-Domain Consistency
     *
     * Evaluates internal logical coherence only.
     * A consistency issue implies an impossible state,
     * not partial data or degradation.
     */
    const consistencyIssues: ConsistencyIssues =
      sessionsPresent === null
        ? null
        : [
            sessionsPresent === false &&
              (multiStepSessionsPresent === true ||
              averageSessionDepthPresent === true) &&
              'depth_without_sessions',

            sessionsPresent === false &&
              surfaceBreadthPresent === true &&
              'breadth_without_sessions',

            sessionsPresent === false &&
              returningSessionsPresent === true &&
              'returning_without_sessions',

            sessionsPresent === false &&
              exitIntentDetected === true &&
              'exit_without_sessions',

            sessionsPresent === false &&
              funnelsDetected === true &&
              'funnels_without_sessions',
          ].filter(Boolean) as ConsistencyIssue[];


  return {
    shopId,
    period,

    // Domain 1 — Identity Presence Reality
    customersPresent,
    identityCoverage,

    // Domain 2 — Activity Presence Reality
    sessionsPresent,

    // Domain 3 — Engagement Structure
    multiStepSessionsPresent,
    averageSessionDepthPresent,

    // Domain 4 — Surface Breadth
    surfaceBreadthPresent,

    // Domain 5 — Returning Behavior
    returningSessionsPresent,

    // Domain 6 — Early Exit
    exitWithoutInteractionPresent,

    // Domain 6 — Exit & Abandonment
    exitIntentDetected,

    // Domain 7 — Journey Structure
    funnelsDetected,

    instrumentationGaps,
    dataFreshness,
    consistencyIssues,

    extractedAt: new Date().toISOString()
  };
}