//apps/backend/src/services/products-intelligence/ProductsIntelligence.types.ts
/**
 * Layer 2 — ProductsIntelligence
 *
 * Internal classification only.
 * Never persisted. Never exposed directly.
 */

export interface ProductsIntelligence {
  productsObserved: number | null;

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  };

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  };
}
