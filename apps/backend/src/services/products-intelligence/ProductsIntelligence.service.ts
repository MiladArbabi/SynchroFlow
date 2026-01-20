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
    variantsObserved,
    productsWithVariantsCount,
    statusCounts,
  } = facts;

  /**
   * Missing-Facts Gate (FT2 Law)
   *
   * If ANY required fact is null, ALL intelligence MUST collapse to 'unknown'.
   *
   * Required facts are those that:
   * - participate in classification
   * - participate in ratios or comparisons
   *
   * This prevents hallucinated certainty.
   */
  const { active, inactive, archived } = statusCounts;

  /**
   * Missing-Facts Gate (FT2 Law)
   *
   * If ANY required fact is null, ALL intelligence MUST collapse to 'unknown'.
   */
  const missing =
    productsObserved === null ||
    productsWithSkuCount === null ||
    variantsObserved === null ||
    productsWithVariantsCount === null ||
    active === null ||
    inactive === null ||
    archived === null;

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

  // ─────────────────────────────────────────
  // outcome (v1 preserved)
  // ─────────────────────────────────────────
  const outcomeStatus =
    active > 0
      ? 'positive'
      : inactive > 0 || archived > 0
      ? 'negative'
      : 'unknown';

  // ─────────────────────────────────────────
  // catalogHealth
  // ─────────────────────────────────────────
  const catalogHealth =
    productsObserved === 0
      ? 'unknown'
      : active > 0
      ? 'healthy'
      : 'degraded';

  // ─────────────────────────────────────────
  // variantComplexity
  //
  // NOTE:
  // - productsWithVariantsCount is guaranteed non-null here
  // - Zero is a valid observable value
  // ─────────────────────────────────────────
  let variantComplexity: ProductsIntelligence['variantComplexity'] = 'simple';

  if (variantsObserved > 0 && productsWithVariantsCount > 0) {
    const avg = variantsObserved / productsWithVariantsCount;
    variantComplexity = avg > 2 ? 'complex' : 'simple';
  }

  // ─────────────────────────────────────────
  // skuCoverage
  // ─────────────────────────────────────────
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
