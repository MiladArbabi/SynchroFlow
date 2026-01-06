//apps/backend/src/services/products-ftep/ProductsFtep.types.ts
/**
 * Layer 3 — ProductsFTEP (Truth Exposure Policy)
 *
 * FT2-safe exposure only.
 * No intelligence internals.
 * No explanations. No recommendations.
 */

export interface ProductsFT2Exposure {
  context: {
    period: {
      from: string;
      to: string;
    };
    productsObserved: number | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;
}