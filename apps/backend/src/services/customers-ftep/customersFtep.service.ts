import { CustomersFacts } from 'api-src/services/customers-facts';
import { CustomersIntelligence } from 'api-src/services/customers-intelligence';
import { CustomersFT2Exposure } from './customersFtep.types';

/**
 * Customers FTEP (FT2)
 * -------------------
 * Truth Exposure Policy for Customers.
 *
 * Rules:
 * - Downgrade only
 * - No enrichment
 * - No timestamps
 * - No intelligence internals
 */
export function applyCustomersFtep(input: {
  facts: CustomersFacts;
  intelligence: CustomersIntelligence;
}): CustomersFT2Exposure {
  const { facts, intelligence } = input;

  const isUnknown = intelligence.outcome.status === 'unknown';

  return {
    context: {
      period: facts.period,
      customersObserved: facts.customersObserved
    },

    outcome: isUnknown ? null : { status: intelligence.outcome.status },

    trend: isUnknown ? null : { direction: intelligence.trend.direction }
  };
}