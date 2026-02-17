//apps/backend/src/services/customers-intelligence/customersIntelligence.service.ts

import { CustomersFacts } from '../../services/customers-facts/index.js';
import { CustomersIntelligence } from './customersIntelligence.types.js';

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

 /**
 * FT2 existence-only classification.
 *
 * IMPORTANT:
 * - Customers FT2 cannot assert explicit absence yet
 * - Zero rows collapse to null at Facts layer
 *
 * Therefore:
 * - null → unknown
 * - > 0  → positive
 * - negative is NOT reachable in FT2 Customers (by design)
 */
  if (facts.customersObserved === null) {
    status = 'unknown';
  } else {
    status = 'positive';
  }

  return {
    outcome: { status },
    trend: { direction: 'unknown' }
  };
}