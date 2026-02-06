// apps/backend/src/services/products-cross-domain-alignment/ProductCrossDomainAlignmentFacts.service.ts

import {
  ProductCrossDomainAlignmentFacts,
} from './ProductCrossDomainAlignmentFacts.types';

interface GetProductCrossDomainAlignmentFactsInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };

  structuralProductsObserved: number | null;
  operationalProductsObserved: number | null;
  supplyProductsObserved: number | null;

  freshnessObserved: {
    structural: string | null;
    inventory: string | null;
    sales: string | null;
    fulfillment: string | null;
    cost: string | null;
  } | null;
}

/**
 * getProductCrossDomainAlignmentFacts
 *
 * Layer 1 (Facts) — Cross-Domain Alignment.
 *
 * GUARANTEES:
 * - Presence-only aggregation
 * - No interpretation
 * - All-or-nothing null semantics
 */
export function getProductCrossDomainAlignmentFacts(
  input: GetProductCrossDomainAlignmentFactsInput
): ProductCrossDomainAlignmentFacts {
  const {
    shopId,
    period,

    structuralProductsObserved,
    operationalProductsObserved,
    supplyProductsObserved,
    freshnessObserved,
  } = input;

  // ─────────────────────────────────────────
  // Missing-facts collapse (GLOBAL)
  // ─────────────────────────────────────────
  if (
    structuralProductsObserved === null ||
    operationalProductsObserved === null ||
    supplyProductsObserved === null ||
    freshnessObserved === null
  ) {
    return {
      shopId,
      period,
      alignmentEvidencePresent: null,
      extractedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────
  // Freshness presence (any domain)
  // ─────────────────────────────────────────
  const hasAnyFreshnessSignal =
    freshnessObserved.structural !== null ||
    freshnessObserved.inventory !== null ||
    freshnessObserved.sales !== null ||
    freshnessObserved.fulfillment !== null ||
    freshnessObserved.cost !== null;

  if (!hasAnyFreshnessSignal) {
    return {
      shopId,
      period,
      alignmentEvidencePresent: null,
      extractedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────
  // Evidence presence (NOT alignment)
  // ─────────────────────────────────────────
  return {
    shopId,
    period,
    alignmentEvidencePresent: true,
    extractedAt: new Date().toISOString(),
  };
}
