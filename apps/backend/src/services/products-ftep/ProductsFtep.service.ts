// apps/backend/src/services/products-ftep/ProductsFtep.service.ts
import { ProductsFacts } from '../products-facts/ProductsFacts.types.js';
import { ProductsIntelligence } from '../products-intelligence/ProductsIntelligence.types.js';
import { ProductsFT2Exposure } from './ProductsFtep.types.js';

interface BuildProductsFtepInput {
  facts: ProductsFacts;
  intelligence: ProductsIntelligence;
  alignment: {
    alignment: 'aligned' | 'misaligned' | 'unknown';
  } | null;
};

/**
 * buildProductsFtep (FT2 v2)
 *
 * Truth Exposure Policy for Products / SKU-OS.
 *
 * SECURITY ROLE:
 * - This is the hard downgrade boundary.
 * - Nothing above this layer may infer, explain, or enrich.
 *
 * RULES (locked by tests):
 * - Always expose context.period
 * - Expose productsObserved ONLY inside context
 * - If outcome === 'unknown' → outcome, trend, signals = null
 * - Never expose raw facts
 * - Never expose intelligence internals
 * - Signals must be lossy, neutral, and non-semantic
 */
export function buildProductsFtep(
  input: BuildProductsFtepInput
): ProductsFT2Exposure {
  const { facts, intelligence, alignment } = input;

  const context = {
    period: facts.period,
    productsObserved: intelligence.productsObserved ?? null,
  };

  // Unknown intelligence → total downgrade
  if (intelligence.outcome.status === 'unknown') {
    return {
      context,
      outcome: null,
      trend: null,
      signals: null,
      productDataIntegrity: null,

      // REQUIRED FT2 domains — default null
      dependency: null,
      operational: null,
      supply: null,
      dataFreshness: null,
      alignment: null,
    };
  }

  /**
   * SIGNAL DOWNGRADES
   *
   * NOTE:
   * These are NOT intelligence values.
   * They are lossy, non-explanatory labels safe for FT2 exposure.
   */
  const signals: ProductsFT2Exposure['signals'] = {
    catalog:
      intelligence.catalogHealth === 'healthy'
        ? 'ok'
        : intelligence.catalogHealth === 'degraded'
        ? 'attention'
        : 'unknown',

    skuCoverage:
      intelligence.skuCoverage === 'complete'
        ? 'ok'
        : intelligence.skuCoverage === 'partial'
        ? 'gaps'
        : 'unknown',

    variantComplexity:
      intelligence.variantComplexity === 'simple'
        ? 'simple'
        : intelligence.variantComplexity === 'complex'
        ? 'complex'
        : 'unknown',
  };

  return {
    context,

    outcome: {
      status: intelligence.outcome.status,
    },

    trend: {
      direction: intelligence.trend.direction,
    },

    signals,
    productDataIntegrity: null,

    dependency: null,
    operational: null,
    supply: null,
    dataFreshness: null,
    alignment,
  };
}