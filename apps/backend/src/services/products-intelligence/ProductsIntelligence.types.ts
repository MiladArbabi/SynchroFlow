// apps/backend/src/services/products-ftep/ProductsFtep.types.ts

/**
 * Layer 2 — ProductsIntelligence (v2)
 *
 * Internal classification only.
 * NEVER exposed directly.
 */

export interface ProductsIntelligence {
  productsObserved: number | null;

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };

  // v2 internal signals (NOT exposed directly)
  catalogHealth: 'healthy' | 'degraded' | 'unknown';
  skuCoverage: 'complete' | 'partial' | 'missing' | 'unknown';
  variantComplexity: 'simple' | 'complex' | 'unknown';
}

/**
 * Layer 3 — ProductsFTEP (Truth Exposure Policy) — v2
 *
 * FT2-safe exposure only.
 *
 * HARD RULES:
 * - No raw facts
 * - No intelligence internals
 * - No explanations
 * - No recommendations
 * - Signals must be lossy and non-semantic
 */
