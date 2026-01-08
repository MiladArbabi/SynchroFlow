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

  if (intelligence.netResult.status === 'unknown') {
    return {
      context: {
        period: facts.period,
        netObserved: facts.netResult,
      },
      outcome: null,
      trend: null,
      dataCoverage: {
        completenessPct: facts.dataCoverage.completenessPct,
      },
    };
  }

  return {
    context: {
      period: facts.period,
      netObserved: facts.netResult,
    },

    outcome: {
      status:
        intelligence.netResult.status === 'good'
          ? 'positive'
          : 'negative',
    },

    trend: intelligence.trend
      ? { direction: intelligence.trend.direction }
      : null,

    dataCoverage: {
      completenessPct: facts.dataCoverage.completenessPct,
    },
  };
}
