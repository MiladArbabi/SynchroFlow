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
}): CustomersFT2Exposure {
  const { facts } = input;

  const ctr = deriveCustomersCTR({ facts });

  return {
    context: {
      period: facts.period,

      /**
       * Domain 1 — Identity Presence Reality
       */
      customersPresent:
        ctr >= CustomerTruthReadiness.CTR_1
          ? facts.customersObserved !== null
            ? facts.customersObserved > 0
            : null
          : null,

      identityCoverage: 'unknown',

      /**
       * Domain 2 — Activity Presence Reality
       *
       * Customers activity is inferred only as existence.
       * No counts exposed.
       */
      activityObserved:
        ctr >= CustomerTruthReadiness.CTR_1
          ? facts.customersObserved !== null
            ? facts.customersObserved > 0
            : null
          : null,
    },

    /**
     * FT2 Customers does NOT expose outcome or trend yet.
     *
     * Reasons:
     * - No continuity
     * - No alignment planes
     * - No downgrade-safe exposure
     *
     * These remain intentionally hidden.
     */
    outcome: null,
    trend: null,
  };
}

/**
 * CTR derivation — Customers FT2
 *
 * Rules:
 * - No observability → CTR_0
 * - Existence observable → CTR_1
 *
 * CTR_2 is NOT reachable in FT2 Customers.
 */
function deriveCustomersCTR(input: {
  facts: CustomersFacts;
}): CustomerTruthReadiness {
  return input.facts.customersObserved === null
    ? CustomerTruthReadiness.CTR_0
    : CustomerTruthReadiness.CTR_1;
}
