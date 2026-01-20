// apps/backend/src/services/specter-intelligence/specterIntelligence.service.ts

import { SpecterFacts } from 'api-src/services/specter-facts/specterFacts.types';

export interface SpecterIntelligence {
  /**
   * Domain 1 — Identity Presence Reality (classified)
   */
  identity: {
    present: boolean | null;
    coverage: 'complete' | 'partial' | 'unknown';
  };

  /**
   * Domain 2 — Activity Presence Reality (classified)
   */
  activity: {
    observed: boolean | null;
    direction: 'unknown'; // continuity not available in FT2
  };

  /**
   * Domain 3 - Engagement classification (internal).
   * Derived strictly from structural existence.
   */
  engagement: {
    status: 'positive' | 'negative' | 'unknown';
  };

  /**
   * Internal-only behavioral metadata.
   * Not exposed in FT2.
   */
  behavior: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
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
   * Domain 3 — Engagement Structure Reality
   *
   * Rules:
   * - null depth signals → unknown
   * - any meaningful structure → positive
   * - observable but no structure → negative
   */
  let engagement: 'positive' | 'negative' | 'unknown' = 'unknown';

  const hasAnyStructuralSignal =
    facts.multiStepSessionsPresent !== null ||
    facts.averageSessionDepthPresent !== null ||
    facts.surfaceBreadthPresent !== null;

  if (!hasAnyStructuralSignal) {
    engagement = 'unknown';
    } else if (
      facts.multiStepSessionsPresent === true ||
      facts.averageSessionDepthPresent === true ||
      facts.surfaceBreadthPresent === true
    ) {
      engagement = 'positive';
    } else {
      engagement = 'negative';
  }

  return {
    /**
     * Domain 1 — Identity Presence Reality
     */
    identity: {
      present: facts.customersPresent,
      coverage: facts.identityCoverage,
    },

    /**
     * Domain 2 — Activity Presence Reality
     */
    activity: {
      observed: facts.sessionsPresent,
      direction: 'unknown',
    },

    /**
     * Domain 3 — Engagement Structure Reality
     */
    engagement: {
      status: engagement,
    },

    /**
     * Internal-only metadata (FT2 locked)
     */
    behavior: {
      direction: 'unknown',
      trend: 'unknown',
    },
  };
}