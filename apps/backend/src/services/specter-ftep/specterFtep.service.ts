// apps/backend/src/services/specter-ftep/specterFtep.service.ts
import { SpecterFacts } from 'api-src/services/specter-facts/specterFacts.types';
import { SpecterIntelligence } from 'api-src/services/specter-intelligence/specterIntelligence.service';
import { SpecterFT2Exposure } from './specterFtep.types';
import { CustomerTruthReadiness } from '../ft2/ctr.types';

/**
 * Specter FTEP
 * ------------
 * Truth Exposure Policy for FT2.
 *
 * Rules:
 * - Downgrade only
 * - CTR governs exposure
 * - No intelligence leakage
 */
export function applySpecterFtep(input: {
  facts: SpecterFacts;
  intelligence: SpecterIntelligence;
}): SpecterFT2Exposure {
  const { facts, intelligence } = input;

  const ctr = deriveSpecterCTR({ facts });

  const sessionsPresent =
    facts.sessionsObserved === null
      ? null
      : facts.sessionsObserved > 0;

  /**
   * activityDirection
   * -----------------
   * FT2-safe downgrade of internal behavioral direction.
   *
   * Rules:
   * - Exposed only when minimum CTR is met
   * - 'unknown' is allowed and meaningful
   * - Never null if CTR allows exposure
   */
  const activityDirection =
    ctr >= CustomerTruthReadiness.CTR_1
      ? intelligence.behavior.direction
      : null;

  /**
   * exitIntentDetected
   * ------------------
   * Existence-only structural signal.
   *
   * Rules:
   * - null  → no sessions / no facts
   * - true  → at least one exit-intent session exists
   * - false → sessions exist, no exit intent
   *
   * Count is never exposed.
   */
  const exitIntentDetected =
    facts.exitIntentSessions === null
      ? null
      : facts.exitIntentSessions > 0;

  /**
   * multiStepSessionsPresent
   * ------------------------
   * Existence-only behavioral depth signal.
   *
   * Rules:
   * - null  → no sessions / no facts
   * - true  → at least one multi-step session exists
   * - false → sessions exist, but all are single-step
   *
   * No counts, no ratios, no inference.
   */
  const multiStepSessionsPresent =
    facts.multiStepSessionsPresent === null
      ? null
      : facts.multiStepSessionsPresent;

  /**
 * surfaceBreadthPresent
 * ---------------------
 * Existence-only surface exploration signal.
 */
  const surfaceBreadthPresent =
    facts.surfaceBreadthPresent === null
      ? null
      : facts.surfaceBreadthPresent;

  /**
   * returningSessionsPresent
   * ------------------------
   * Existence-only returning behavior signal.
   */
  const returningSessionsPresent =
    facts.returningSessionsPresent === null
      ? null
      : facts.returningSessionsPresent;

  /**
   * exitWithoutInteractionPresent
   * -----------------------------
   * Existence-only early exit signal.
   *
   * Rules:
   * - null  → no sessions / no facts
   * - true  → at least one session exited with no interaction
   * - false → sessions exist, none match
   */
  const exitWithoutInteractionPresent =
    facts.exitWithoutInteractionPresent === null
      ? null
      : facts.exitWithoutInteractionPresent;

    /**
   * averageSessionDepthPresent
   * --------------------------
   * Existence-only depth quality signal.
   */
  const averageSessionDepthPresent =
    facts.averageSessionDepthPresent === null
      ? null
      : facts.averageSessionDepthPresent;

  return {
    context: {
      period: facts.period,
      sessionsObserved:
        ctr >= CustomerTruthReadiness.CTR_1
          ? facts.sessionsObserved
          : null,
    },

    outcome:
      ctr >= CustomerTruthReadiness.CTR_1 &&
      intelligence.engagement.status !== 'unknown'
        ? { status: intelligence.engagement.status }
        : null,

   /**
     * Directional movement (FT2-safe).
     * Rendered directly by Customers UI.
     */
    activityDirection,

      signals: {
        /**
         * Structural signals only.
         * Entitlement gating happens downstream.
         */
        exitIntentDetected:
          ctr >= CustomerTruthReadiness.CTR_1
            ? exitIntentDetected
            : null,

        funnelsDetected:
          ctr >= CustomerTruthReadiness.CTR_1
            ? facts.funnelsDetected
            : null,

        multiStepSessionsPresent:
          ctr >= CustomerTruthReadiness.CTR_1
            ? multiStepSessionsPresent
            : null,

        surfaceBreadthPresent:
          ctr >= CustomerTruthReadiness.CTR_1
            ? surfaceBreadthPresent
            : null,

        returningSessionsPresent:
          ctr >= CustomerTruthReadiness.CTR_1
            ? returningSessionsPresent
            : null,

        exitWithoutInteractionPresent:
          ctr >= CustomerTruthReadiness.CTR_1
            ? exitWithoutInteractionPresent
            : null,

        averageSessionDepthPresent:
          ctr >= CustomerTruthReadiness.CTR_1
            ? averageSessionDepthPresent
            : null,
      },

     /**
     * dataCoverage
     * ------------
     * FT2-safe observability coverage downgrade.
     *
     * Rules:
     * - true  → complete (sessions exist)
     * - false → insufficient (explicitly no sessions)
     * - null  → unknown (cannot determine)
     *
     * No partial coverage is emitted yet.
     */
    dataCoverage:
      sessionsPresent === true
        ? 'complete'
        : sessionsPresent === false
          ? 'insufficient'
          : null,
  };
}

/**
 * CTR derivation — Specter
 * -----------------------
 * Based strictly on session observability.
 */
function deriveSpecterCTR(input: {
  facts: SpecterFacts;
}): CustomerTruthReadiness {
  if (input.facts.sessionsObserved === null) {
    return CustomerTruthReadiness.CTR_0;
  }

  return CustomerTruthReadiness.CTR_1;
}