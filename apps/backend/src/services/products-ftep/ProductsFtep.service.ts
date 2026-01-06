//apps/backend/src/services/products-ftep/ProductsFtep.service.ts
import { ProductsFacts } from '../products-facts/ProductsFacts.types';
import { ProductsIntelligence } from '../products-intelligence/ProductsIntelligence.types';
import { ProductsFT2Exposure } from './ProductsFtep.types';

interface BuildProductsFtepInput {
  facts: ProductsFacts;
  intelligence: ProductsIntelligence;
}

/**
 * buildProductsFtep
 *
 * Downgrades internal intelligence into FT2-safe observability.
 *
 * Rules (locked by tests):
 * - Always expose context.period
 * - Expose productsObserved only in context
 * - If intelligence outcome is 'unknown' → outcome & trend = null
 * - Never expose intelligence internals or raw facts
 */
export function buildProductsFtep(
  input: BuildProductsFtepInput
): ProductsFT2Exposure {
  const { facts, intelligence } = input;

  const context = {
    period: facts.period,
    productsObserved: intelligence.productsObserved,
  };

  if (intelligence.outcome.status === 'unknown') {
    return {
      context,
      outcome: null,
      trend: null,
    };
  }

  return {
    context,
    outcome: {
      status: intelligence.outcome.status,
    },
    trend: {
      direction: intelligence.trend.direction,
    },
  };
}