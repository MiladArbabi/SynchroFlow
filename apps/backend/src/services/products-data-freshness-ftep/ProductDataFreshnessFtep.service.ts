// apps/backend/src/services/products-data-freshness-ftep/ProductDataFreshnessFtep.service.ts

import { ProductDataFreshnessIntelligence } from '../products-data-freshness-intelligence/ProductDataFreshnessIntelligence.types.js';
import { ProductDataFreshnessFT2Exposure } from './ProductDataFreshnessFtep.types.js';

/**
 * buildProductDataFreshnessFtep
 *
 * Truth Exposure Policy for Data Freshness.
 *
 * SECURITY ROLE:
 * - Hard downgrade boundary
 * - Per-domain suppression
 *
 * RULES:
 * - Each domain evaluated independently
 * - 'unknown' intelligence → null exposure
 * - No cross-domain collapse
 */
export function buildProductDataFreshnessFtep(
  input: { intelligence: ProductDataFreshnessIntelligence }
): ProductDataFreshnessFT2Exposure {
  const { intelligence } = input;

  const expose = (
    value: 'fresh' | 'stale' | 'unknown'
  ): 'fresh' | 'stale' | 'unknown' | null => {
    if (value === 'unknown') return null;
    return value;
  };

  return {
    freshness: {
      structural: expose(intelligence.structural),
      inventory: expose(intelligence.inventory),
      sales: expose(intelligence.sales),
      fulfillment: expose(intelligence.fulfillment),
      cost: expose(intelligence.cost),
    },
  };
}