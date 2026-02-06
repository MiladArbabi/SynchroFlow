// apps/backend/src/services/products-cross-domain-alignment/ProductCrossDomainAlignmentFtep.service.ts

import { ProductCrossDomainAlignmentFT2Exposure } from './ProductCrossDomainAlignmentFtep.types';
import { ProductCrossDomainAlignmentIntelligence } from './ProductCrossDomainAlignmentIntelligence.types';

interface BuildAlignmentFtepInput {
  facts: {
    alignmentEvidencePresent: boolean | null;
  } | null;

  intelligence: ProductCrossDomainAlignmentIntelligence | null;
}

/**
 * buildProductCrossDomainAlignmentFtep
 *
 * Layer 3 (FTEP) — Exposure gate for cross-domain alignment.
 *
 * GUARANTEES:
 * - Exposure ONLY when facts explicitly allow it
 * - No reinterpretation of intelligence
 * - No defaulting, no backfilling
 * - Null means "not eligible for exposure"
 */
export function buildProductCrossDomainAlignmentFtep(
  input: BuildAlignmentFtepInput
): ProductCrossDomainAlignmentFT2Exposure | null {
  const { facts, intelligence } = input;

  // ─────────────────────────────────────────
  // Hard exposure gate
  // ─────────────────────────────────────────
  if (
    !facts ||
    facts.alignmentEvidencePresent !== true ||
    !intelligence
  ) {
    return null;
  }

  // ─────────────────────────────────────────
  // Pass-through exposure (no mutation)
  // ─────────────────────────────────────────
  return {
    alignment: intelligence.alignment,
  };
}