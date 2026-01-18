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
export function deriveSpecterIntelligence(
  facts: SpecterFacts
): SpecterIntelligence {
  /**
   * Missing or insufficient facts → unknown intelligence
   */
  if (
    facts.sessionsObserved === null ||
    facts.exitIntentSessions === null
  ) {
    return {
      engagement: { status: 'unknown' },
      behavior: {
        direction: 'unknown',
        trend: 'unknown',
      },
    };
  }

  /**
   * Engagement (existing logic)
   * ---------------------------
   * Internal-only heuristic.
   */
  const engagementStatus =
    facts.exitIntentSessions / facts.sessionsObserved >= 0.5
      ? 'negative'
      : 'positive';

  /**
   * Direction (NEW)
   * ---------------
   * Minimal, deterministic, continuity-based.
   *
   * Rules:
   * - No comparison window available → flat
   * - No magnitude, no thresholds
   * - No explanation
   */
  const direction: 'up' | 'down' | 'flat' | 'unknown' =
    facts.sessionsObserved > 0
      ? 'flat'
      : 'unknown';

  /**
   * Trend (existing logic)
   */
  const trend: 'stable' | 'volatile' | 'unknown' =
    facts.funnelsDetected === null
      ? 'unknown'
      : facts.funnelsDetected
        ? 'stable'
        : 'volatile';

  return {
    engagement: { status: engagementStatus },
    behavior: {
      direction,
      trend,
    },
  };
}