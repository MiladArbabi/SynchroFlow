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
  const { productsObserved, statusCounts } = facts;

  // Missing facts → unknown
  if (
    productsObserved === null ||
    statusCounts.active === null ||
    statusCounts.inactive === null ||
    statusCounts.archived === null
  ) {
    return {
      productsObserved,
      outcome: { status: 'unknown' },
      trend: { direction: 'unknown' },
    };
  }

  // Classification only
  if (statusCounts.active > 0) {
    return {
      productsObserved,
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },
    };
  }

  if (statusCounts.inactive > 0 || statusCounts.archived > 0) {
    return {
      productsObserved,
      outcome: { status: 'negative' },
      trend: { direction: 'unknown' },
    };
  }

  return {
    productsObserved,
    outcome: { status: 'unknown' },
    trend: { direction: 'unknown' },
  };
}