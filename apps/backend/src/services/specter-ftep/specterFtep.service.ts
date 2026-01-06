import { SpecterFacts } from 'api-src/services/specter-facts/specterFacts.types';
import { SpecterIntelligence } from 'api-src/services/specter-intelligence/specterIntelligence.service';
import { SpecterFT2Exposure } from './specterFtep.types';

/**
 * Specter FTEP
 * ------------
 * Truth Exposure Policy for FT2.
 *
 * HARD RULES:
 * - No intelligence structures exposed
 * - No explanations
 * - No percentages
 * - Downgrade only
 */
export function applySpecterFtep(input: {
  facts: SpecterFacts;
  intelligence: SpecterIntelligence;
}): SpecterFT2Exposure {
  const { facts, intelligence } = input;

  const sessionsPresent =
    facts.sessionsObserved === null ? null : facts.sessionsObserved > 0;

  return {
    context: {
      period: facts.period,
      sessionsObserved: facts.sessionsObserved
    },

    outcome:
      intelligence.engagement.status === 'unknown'
        ? null
        : { status: intelligence.engagement.status },

    signals: {
      funnelsDetected: facts.funnelsDetected
    },

    dataCoverage: {
      sessionsPresent
    }
  };
}