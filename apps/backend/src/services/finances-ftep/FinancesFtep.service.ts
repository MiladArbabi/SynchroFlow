import type { FinancesFacts } from 'api-src/services/finances-facts/FinancesFacts.types';
import type { FinancesIntelligence } from 'api-src/services/finances-intelligence/FinancesIntelligence.service';
import type { FinancesFT2Exposure } from './FinancesFtep.types';

/**
 * Finances FTEP — Truth Exposure Policy
 * -----------------------------------
 * Downgrades intelligence into FT2-safe observability.
 *
 * Rules:
 * - Strip all sensitive intelligence
 * - No new meaning
 * - No thresholds
 * - Null when indeterminate
 */
export function buildFinancesFtep(input: {
  facts: FinancesFacts;
  intelligence: FinancesIntelligence;
}): FinancesFT2Exposure {
  const { facts, intelligence } = input;

  const outcome: FinancesFT2Exposure['outcome'] =
    intelligence.netResult.status === 'unknown'
      ? null
      : {
          status:
            intelligence.netResult.status === 'good'
              ? 'positive'
              : 'negative',
        };

  return {
    context: {
      period: facts.period,
      netObserved: facts.netResult,
    },

    outcome,

    trend: intelligence.trend
      ? {
          direction: intelligence.trend.direction,
        }
      : null,

    dataCoverage: {
      completenessPct: facts.dataCoverage.completenessPct,
    },
  };
}
