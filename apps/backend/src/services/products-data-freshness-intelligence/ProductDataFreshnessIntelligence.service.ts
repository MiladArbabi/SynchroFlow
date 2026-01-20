// apps/backend/src/services/products-data-freshness-intelligence/ProductDataFreshnessIntelligence.service.ts
import { ProductDataFreshnessFacts } from '../products-data-freshness-facts/ProductDataFreshnessFacts.types';
import { ProductDataFreshnessIntelligence } from './ProductDataFreshnessIntelligence.types';

/**
 * buildProductDataFreshnessIntelligence
 *
 * Converts freshness facts → presence-only intelligence.
 *
 * GUARANTEES:
 * - No DB access
 * - No time math
 * - No thresholds
 * - No cross-domain inference
 * - Missing facts collapse to 'unknown'
 */
export function buildProductDataFreshnessIntelligence(
  facts: ProductDataFreshnessFacts
): ProductDataFreshnessIntelligence {
  /**
   * Missing-Facts Gate (FT2 Law)
   *
   * If ANY required freshness fact is undefined,
   * that domain collapses to 'unknown'.
   */
  const classify = (
    ts: string | null | undefined
  ): 'fresh' | 'stale' | 'unknown' => {
    if (ts === undefined) return 'unknown';
    if (ts === null) return 'stale';
    return 'fresh';
  };

  return {
    structural: classify(facts.structuralLastObservedAt),
    inventory: classify(facts.inventoryLastObservedAt),
    sales: classify(facts.salesLastObservedAt),
    fulfillment: classify(facts.fulfillmentLastObservedAt),
    cost: classify(facts.costLastObservedAt),
  };
}