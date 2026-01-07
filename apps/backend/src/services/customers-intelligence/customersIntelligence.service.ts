//apps/backend/src/services/customers-intelligence/customersIntelligence.service.ts
import { CustomersFacts } from 'api-src/services/customers-facts';
import { CustomersIntelligence } from './customersIntelligence.types';

/**
 * Customers Intelligence (FT2)
 * ----------------------------
 * Pure classification from facts.
 *
 * Rules:
 * - No DB access
 * - Deterministic
 * - No semantics
 * - No trends in FT2 Customers
 */
export function deriveCustomersIntelligence(
  facts: CustomersFacts
): CustomersIntelligence {
  let status: CustomersIntelligence['outcome']['status'] = 'unknown';

  if (facts.customersObserved === null) {
    status = 'unknown';
  } else if (facts.customersObserved > 0) {
    status = 'positive';
  } else {
    status = 'negative';
  }

  return {
    outcome: { status },
    trend: { direction: 'unknown' }
  };
}