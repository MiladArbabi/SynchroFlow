//apps/backend/src/services/products-facts/ProductsFacts.types.ts
/**
 * Layer 1 — ProductsFacts
 *
 * Raw, interpretation-free truth extracted from persistence.
 * This layer:
 * - Touches the database directly
 * - Preserves nulls
 * - Does NOT classify, infer, or explain
 */

export interface ProductsFacts {
  shopId: number;
  period: {
    from: string;
    to: string;
  };

  productsObserved: number | null;
  skusObserved: number | null;

  statusCounts: {
    active: number | null;
    inactive: number | null;
    archived: number | null;
  };

  extractedAt: string;
}