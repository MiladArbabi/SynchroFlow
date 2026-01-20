// apps/backend/src/services/products-facts/ProductsFacts.types.ts

/**
 * Layer 1 — ProductsFacts
 *
 * Raw, interpretation-free truth extracted from persistence.
 *
 * INVARIANTS:
 * - Touches the database directly
 * - Preserves nulls when no rows exist
 * - Does NOT classify, infer, or explain
 * - All fields are raw counts or timestamps
 * - null ≠ 0
 */
export interface ProductsFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  /** Total canonical rows observed (product × variant rows) */
  productsObserved: number | null;

  /** Distinct non-null SKUs observed */
  skusObserved: number | null;

  /** SKU structure facts (v2) */
  distinctSkusObserved: number | null;
  productsWithSkuCount: number | null;
  productsWithoutSkuCount: number | null;

  /** Variant structure facts (v2) */
  variantsObserved: number | null;
  productsWithVariantsCount: number | null;
  singleVariantProductsCount: number | null;

  /** Status distribution (unchanged v1) */
  statusCounts: {
    active: number | null;
    inactive: number | null;
    archived: number | null;
  };

  /**
   * Extraction timestamp
   *
   * Semantics:
   * - Indicates when facts were computed
   * - NOT a business event time
   * - MUST NOT be exposed beyond FTEP
   */
  extractedAt: string;
}