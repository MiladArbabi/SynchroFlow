//apps/backend/src/services/products-intelligence/ProductsIntelligence.service.ts
import { ProductsFacts } from '../products-facts/ProductsFacts.types';
import { ProductsIntelligence } from './ProductsIntelligence.types';

/**
 * buildProductsIntelligence
 *
 * Converts ProductsFacts → internal intelligence signals.
 *
 * Rules (locked by tests):
 * - positive: ≥1 active product
 * - negative: 0 active AND ≥1 inactive or archived
 * - unknown: missing facts
 * - trend: always 'unknown' (no historical comparison)
 *
 * Forbidden:
 * - DB access
 * - Explanations
 * - Recommendations
 */
export function buildProductsIntelligence(
  facts: ProductsFacts
): ProductsIntelligence {
  const {
    productsObserved,
    productsWithSkuCount,
    productsWithoutSkuCount,
    variantsObserved,
    productsWithVariantsCount,
    statusCounts,
  } = facts as any;

  const missing =
    productsObserved === null ||
    statusCounts?.active === null ||
    productsWithSkuCount === null ||
    variantsObserved === null;

  if (missing) {
    return {
      productsObserved,
      outcome: { status: 'unknown' },
      trend: { direction: 'unknown' },
      catalogHealth: 'unknown',
      skuCoverage: 'unknown',
      variantComplexity: 'unknown',
    };
  }

  // ── outcome (v1 preserved)
  const outcomeStatus =
    statusCounts.active > 0
      ? 'positive'
      : statusCounts.inactive > 0 || statusCounts.archived > 0
      ? 'negative'
      : 'unknown';

  // ── catalogHealth
  const catalogHealth =
    productsObserved === 0
      ? 'unknown'
      : statusCounts.active > 0
      ? 'healthy'
      : 'degraded';

  // ── variantComplexity
  let variantComplexity: ProductsIntelligence['variantComplexity'] = 'simple';

  if (variantsObserved > 0 && productsWithVariantsCount > 0) {
    const avg = variantsObserved / productsWithVariantsCount;
    variantComplexity = avg > 2 ? 'complex' : 'simple';
  }

  // ── skuCoverage
  const skuCoverage =
    productsWithSkuCount === productsObserved
      ? 'complete'
      : productsWithSkuCount > 0
      ? 'partial'
      : 'missing';

  return {
    productsObserved,
    outcome: { status: outcomeStatus },
    trend: { direction: 'unknown' },
    catalogHealth,
    skuCoverage,
    variantComplexity,
  };
}
