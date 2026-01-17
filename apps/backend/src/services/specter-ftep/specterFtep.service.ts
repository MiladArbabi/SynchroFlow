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
 */
export function applySpecterFtep(input: {
  facts: SpecterFacts;
  intelligence: SpecterIntelligence;
}): SpecterFT2Exposure {
  const { facts, intelligence } = input;

  const ctr = deriveSpecterCTR({ facts });

  const sessionsPresent =
    facts.sessionsObserved === null ? null : facts.sessionsObserved > 0;

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

    signals: {
      funnelsDetected:
        ctr >= CustomerTruthReadiness.CTR_1
          ? facts.funnelsDetected
          : null,
    },

    dataCoverage: {
      sessionsPresent,
    },
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