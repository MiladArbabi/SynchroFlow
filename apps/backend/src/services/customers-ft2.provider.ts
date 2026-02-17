// apps/backend/src/services/customers-ft2.provider.ts
import { getCustomersFacts } from "./customers-facts/customersFacts.service.js";
import { applyCustomersFtep } from "./customers-ftep/customersFtep.service.js";
import { CustomersFT2Exposure } from "./customers-ftep/customersFtep.types.js";

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
  /**
 * FT2 Customers does not expose intelligence.
 * Intelligence is computed later when alignment planes exist.
 */
  const exposure = applyCustomersFtep({ facts });

  return exposure;
}