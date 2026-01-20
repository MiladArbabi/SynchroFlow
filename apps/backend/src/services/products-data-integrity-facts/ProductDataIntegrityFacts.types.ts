/**
 * Layer 1 — ProductDataIntegrityFacts
 *
 * Observable, interpretation-free facts describing
 * internal consistency of product representations.
 *
 * This layer answers:
 *   “Do multiple representations of the same product disagree?”
 *
 * It explicitly does NOT answer:
 * - why inconsistencies exist
 * - which system is correct
 * - how to fix anything
 *
 * Null semantics:
 * - null = no observable truth (not zero)
 * - zero = observed absence
 */
export interface ProductDataIntegrityFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  /**
   * Number of canonical products evaluated for integrity.
   * Null when no products are observable in the period.
   */
  productsChecked: number | null;

  /**
   * Products where at least one critical field
   * differs across linked system representations.
   */
  productsWithConflictingFields: number | null;

  /**
   * Products represented by more than one SKU.
   * (Observable duplication, not judgment.)
   */
  productsWithMultipleSkus: number | null;

  /**
   * Maximum number of SKUs observed for any single product.
   * Indicates duplication intensity, not severity.
   */
  maxSkusPerProduct: number | null;

  /**
   * Extraction timestamp.
   * NOT a business event time.
   * MUST NOT escape FTEP.
   */
  extractedAt: string;
}