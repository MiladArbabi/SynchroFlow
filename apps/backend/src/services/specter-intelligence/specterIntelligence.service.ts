// apps/backend/src/services/specter-intelligence/specterIntelligence.service.ts

import { SpecterFacts } from 'api-src/services/specter-facts/specterFacts.types';

export interface SpecterIntelligence {
  engagement: {
    status: 'positive' | 'negative' | 'unknown';
  };
  behavior: {
    /**
     * Internal-only behavioral direction.
     * Never exposed directly to UI.
     */
    direction: 'up' | 'down' | 'flat' | 'unknown';

    /**
     * Internal stability signal (existing).
     */
    trend: 'stable' | 'volatile' | 'unknown';
  };
}

/**
 * Specter Intelligence
 * --------------------
 * Classification-only layer.
 *
 * HARD RULES:
 * - No persistence access
 * - No percentages exposed
 * - No explanations
 * - No UI semantics
 */
/**
 * Specter Intelligence (FT2-compliant)
 * -----------------------------------
 * Classification-only. No math. No ratios.
 *
 * Rules:
 * - Existence-only inputs
 * - Unknown propagated aggressively
 * - Direction & trend require continuity (not available in FT2)
 */
export function deriveSpecterIntelligence(
  facts: SpecterFacts
): SpecterIntelligence {
  /**
   * No session presence → no intelligence
   */
  if (facts.sessionsPresent === null) {
    return {
      engagement: { status: 'unknown' },
      behavior: {
        direction: 'unknown',
        trend: 'unknown',
      },
    };
  }

  /**
   * Engagement classification (existence-only)
   *
   * Logic:
   * - Exit intent present → negative
   * - Meaningful engagement signals present → positive
   * - Otherwise → unknown
   *
   * No magnitude. No ratios. No thresholds.
   */
  let engagement: 'positive' | 'negative' | 'unknown' = 'unknown';

  if (facts.exitIntentDetected === true) {
    engagement = 'negative';
  } else if (
    facts.multiStepSessionsPresent === true ||
    facts.surfaceBreadthPresent === true ||
    facts.returningSessionsPresent === true
  ) {
    engagement = 'positive';
  }

  /**
   * Direction & trend
   * -----------------
   * FT2 does not provide continuity or temporal comparison.
   * Therefore these signals must remain unknown.
   */
  return {
    engagement: { status: engagement },
    behavior: {
      direction: 'unknown',
      trend: 'unknown',
    },
  };
}
