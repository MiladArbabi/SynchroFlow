//apps/backend/src/services/specter-intelligence/specterIntelligence.service.ts
import { SpecterFacts } from 'api-src/services/specter-facts/specterFacts.types';

export interface SpecterIntelligence {
  engagement: {
    status: 'positive' | 'negative' | 'unknown';
  };
  behavior: {
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
  if (
    facts.sessionsObserved === null ||
    facts.exitIntentSessions === null
  ) {
    return {
      engagement: { status: 'unknown' },
      behavior: { trend: 'unknown' }
    };
  }

  // Internal-only heuristic (not exposed):
  // negative if exit intent >= 50%
  const engagementStatus =
    facts.exitIntentSessions / facts.sessionsObserved >= 0.5
      ? 'negative'
      : 'positive';

  // Minimal, deterministic behavior signal
  const behaviorTrend =
    facts.funnelsDetected === null
      ? 'unknown'
      : facts.funnelsDetected
        ? 'stable'
        : 'volatile';

  return {
    engagement: { status: engagementStatus },
    behavior: { trend: behaviorTrend }
  };
}