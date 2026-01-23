// apps/backend/src/services/products-data-freshness.provider.ts

import {
  getProductDataFreshnessFacts,
} from './products-data-freshness-facts';
import {
  buildProductDataFreshnessIntelligence,
} from './products-data-freshness-intelligence';
import {
  buildProductDataFreshnessFtep,
} from './products-data-freshness-ftep';
import {
  ProductDataFreshnessFT2Exposure,
} from './products-data-freshness-ftep/ProductDataFreshnessFtep.types';

interface GetProductDataFreshnessSnapshotInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * getProductDataFreshnessSnapshot
 *
 * FT2 Product Data Freshness provider.
 *
 * RESPONSIBILITIES:
 * - Orchestrate Facts → Intelligence → FTEP
 * - Expose FT2-safe freshness signals
 *
 * NON-RESPONSIBILITIES:
 * - Lifecycle inference
 * - Trust evaluation
 * - UI shaping
 * - Time delta reasoning
 */
export async function getProductDataFreshnessSnapshot(
  input: GetProductDataFreshnessSnapshotInput
): Promise<ProductDataFreshnessFT2Exposure | null> {
  const { shopId, period } = input;

  const facts = await getProductDataFreshnessFacts({
    shopId,
    period,
  });

  const intelligence =
    buildProductDataFreshnessIntelligence(facts);

  const exposure =
    buildProductDataFreshnessFtep({ intelligence });

  return exposure;
}
