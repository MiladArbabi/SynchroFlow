// apps/backend/src/services/products-data-integrity.provider.ts
import { getProductDataIntegrityFacts } from "./products-data-integrity-facts/ProductDataIntegrityFacts.service.js";
import { buildProductDataIntegrityFtep } from "./products-data-integrity-ftep/ProductDataIntegrityFtep.service.js";
import { ProductDataIntegrityFT2Exposure } from "./products-data-integrity-ftep/ProductDataIntegrityFtep.types.js";
import { buildProductDataIntegrityIntelligence } from "./products-data-integrity-intelligence/ProductDataIntegrityIntelligence.service.js";

interface GetProductDataIntegritySnapshotInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * getProductDataIntegritySnapshot
 *
 * FT2-Paid Product Data Integrity provider.
 *
 * RESPONSIBILITIES:
 * - Orchestrate Facts → Intelligence → FTEP
 * - Enforce entitlement via soft downgrade
 *
 * NON-RESPONSIBILITIES:
 * - Lifecycle inference
 * - Billing logic
 * - Role resolution
 * - UI shaping
 */
export async function getProductDataIntegritySnapshot(
  input: GetProductDataIntegritySnapshotInput
): Promise<ProductDataIntegrityFT2Exposure | null> {
  const { shopId, period } = input;

/**
 * FT2 Unified Mode (Temporary)
 *
 * Entitlements are NOT enforced here.
 * All FT2 surfaces are computed and exposed.
 *
 * Commercial constraints will be applied
 * in a future entitlement pass.
 */

  const facts = await getProductDataIntegrityFacts({
    shopId,
    period,
  });

  const intelligence =
    buildProductDataIntegrityIntelligence(facts);

  const exposure =
    buildProductDataIntegrityFtep({ intelligence });

  return exposure;
}