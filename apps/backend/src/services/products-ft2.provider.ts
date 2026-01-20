// apps/backend/src/services/products-ft2.provider.ts
import { getProductsFacts } from './products-facts';
import { buildProductsIntelligence } from './products-intelligence';
import { buildProductsFtep } from './products-ftep';
import { ProductsFT2Exposure } from './products-ftep/ProductsFtep.types';
import {
  getProductDataIntegritySnapshot,
} from './products-data-integrity.provider';

interface GetProductsFt2SnapshotInput {
  shopId: number;
  period: { from: string; to: string };

  /**
   * Entitlement resolution is passed in.
   * Provider never infers.
   */
  entitlements: {
    productDataIntegrity: {
      allowed: boolean;
    };
  };
}

/**
 * Products FT2 Provider
 * --------------------
 * Orchestrates the FT2 pipeline:
 *
 *   Facts → Intelligence → FTEP
 *
 * Rules:
 * - No lifecycle decisions
 * - No persistence beyond Facts
 * - No intelligence leakage
 * - Deterministic for identical inputs
 */
export async function getProductsFt2Snapshot(input: {
  shopId: number;
  period: { from: string; to: string };
}): Promise<ProductsFT2Exposure> {
  const { shopId, period } = input;

  const facts = await getProductsFacts(input);
  const intelligence = buildProductsIntelligence(facts);
  const exposure = buildProductsFtep({ facts, intelligence });

  // ─────────────────────────────────────────
  // FT2-Paid — Product Data Integrity
  // ─────────────────────────────────────────
  const productDataIntegrity =
  await getProductDataIntegritySnapshot({
    shopId,
    period,
  });

  return {
    ...exposure,
    productDataIntegrity,
  };
}