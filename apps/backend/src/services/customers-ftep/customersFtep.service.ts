import { CustomersFacts } from 'api-src/services/customers-facts';
import { CustomersIntelligence } from 'api-src/services/customers-intelligence';
import { CustomersFT2Exposure } from './customersFtep.types';
import { CustomerTruthReadiness } from '../ft2/ctr.types';

/**
 * Customers FTEP (FT2)
 * -------------------
 * Truth Exposure Policy for Customers.
 *
 * Rules:
 * - Downgrade only
 * - No enrichment
 * - CTR governs exposure
 */
export function applyCustomersFtep(input: {
  facts: CustomersFacts;
  intelligence: CustomersIntelligence;
}): CustomersFT2Exposure {
  const { facts, intelligence } = input;

  const ctr = deriveCustomersCTR({ facts, intelligence });

  return {
    context: {
      period: facts.period,
      customersObserved:
        ctr >= CustomerTruthReadiness.CTR_2
          ? facts.customersObserved
          : null,
    },

    outcome:
      ctr >= CustomerTruthReadiness.CTR_2
        ? { status: intelligence.outcome.status }
        : null,

    trend:
      ctr >= CustomerTruthReadiness.CTR_2
        ? { direction: intelligence.trend.direction }
        : null,
  };
}

/**
 * CTR derivation — Customers
 * -------------------------
 * Based strictly on existing facts + intelligence.
 */
function deriveCustomersCTR(input: {
  facts: CustomersFacts;
  intelligence: CustomersIntelligence;
}): CustomerTruthReadiness {
  const { facts, intelligence } = input;

  if (facts.customersObserved === null) {
    return CustomerTruthReadiness.CTR_1;
  }

  if (intelligence.outcome.status === 'unknown') {
    return CustomerTruthReadiness.CTR_1;
  }

  return CustomerTruthReadiness.CTR_2;
}