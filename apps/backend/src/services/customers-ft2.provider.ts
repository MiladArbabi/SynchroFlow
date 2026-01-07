// apps/backend/src/services/customers-ft2.provider.ts
import { getCustomersFacts } from './customers-facts';
import { deriveCustomersIntelligence } from './customers-intelligence';
import { applyCustomersFtep } from './customers-ftep';
import { CustomersFT2Exposure } from './customers-ftep/customersFtep.types';

/**
 * Customers FT2 Provider
 * ---------------------
 * Orchestrates:
 *   Facts → Intelligence → FTEP
 *
 * Rules:
 * - Deterministic
 * - No enrichment
 * - No lifecycle logic
 * - No persistence beyond Facts
 */
export async function getCustomersFt2Snapshot(input: {
  shopId: number;
  period: { from: string; to: string };
}): Promise<CustomersFT2Exposure> {
  const facts = await getCustomersFacts(input);
  const intelligence = deriveCustomersIntelligence(facts);
  const exposure = applyCustomersFtep({ facts, intelligence });

  return exposure;
}