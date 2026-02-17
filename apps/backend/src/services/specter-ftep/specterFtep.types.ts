// apps/backend/src/services/specter-ftep/specterFtep.types.ts

import { ConsistencyIssues, InstrumentationGaps } from "../../services/specter-facts/specterFacts.types.js";


export interface SpecterFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };

    /**
     * ─────────────────────────────────────
     * Domain 1 — Identity Presence Reality
     * ─────────────────────────────────────
     *
     * NOTE:
     * Specter currently cannot observe identity.
     * This field exists to preserve domain wiring.
     */
    customersPresent: boolean | null;

    /**
     * Trust signal for identity observability.
     * Always 'unknown' for Specter FT2 today.
     */
    identityCoverage: 'complete' | 'partial' | 'unknown';

    /**
     * ─────────────────────────────────────
     * Domain 2 — Activity Presence Reality
     * ─────────────────────────────────────
     *
     * Existence-only session observability.
     */
    sessionsPresent: boolean | null;
  };

  /**
   * Domain 3 — Engagement Structure Reality (FT2-safe)
   */
    engagement: {
      status: 'positive' | 'negative' | 'unknown' | null;
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

    /**
     * Meta-observability signal.
     * Describes data recency, not customers.
     */
    dataFreshness: boolean | null;

    consistencyIssues: ConsistencyIssues;
  };

  /**
   * ─────────────────────────────────────
   * Domain 10 — Instrumentation Gaps Reality
   * ─────────────────────────────────────
   *
   * Meta-observability. NOT a customer signal.
   */
  instrumentationGaps: InstrumentationGaps;

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