// apps/backend/src/services/products-cross-domain-alignment/ProductCrossDomainAlignmentFacts.types.ts

/**
 * ProductCrossDomainAlignmentFacts
 *
 * Layer 1 (Facts) — Cross-Domain Alignment Evidence.
 *
 * This type represents ONLY the presence of
 * mutually observable domain evidence.
 *
 * It does NOT express alignment or misalignment.
 */
export interface ProductCrossDomainAlignmentFacts {
  shopId: number;

  period: {
    from: string;
    to: string;
  };

  /**
   * Indicates whether sufficient cross-domain
   * evidence exists to evaluate alignment.
   *
   * Semantics:
   * - null → insufficient or missing facts
   * - true → evidence present (interpretation deferred)
   */
  alignmentEvidencePresent: boolean | null;

  extractedAt: string;
}
