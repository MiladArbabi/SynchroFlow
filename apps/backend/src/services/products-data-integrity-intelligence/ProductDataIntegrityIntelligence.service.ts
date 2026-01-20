import {
  ProductDataIntegrityFacts,
} from '../products-data-integrity-facts/ProductDataIntegrityFacts.types';
import {
  ProductDataIntegrityIntelligence,
} from './ProductDataIntegrityIntelligence.types';

/**
 * buildProductDataIntegrityIntelligence
 *
 * Converts ProductDataIntegrityFacts → internal intelligence.
 *
 * GATING LAW (NON-NEGOTIABLE):
 * - If ANY required fact is null,
 *   ALL intelligence collapses to 'unknown'.
 *
 * Required facts:
 * - productsChecked
 * - productsWithConflictingFields
 * - productsWithMultipleSkus
 *
 * This prevents hallucinated certainty.
 */
export function buildProductDataIntegrityIntelligence(
  facts: ProductDataIntegrityFacts
): ProductDataIntegrityIntelligence {
  const {
    productsChecked,
    productsWithConflictingFields,
    productsWithMultipleSkus,
  } = facts;

  const missing =
    productsChecked === null ||
    productsWithConflictingFields === null ||
    productsWithMultipleSkus === null;

  // ─────────────────────────────────────────
  // Missing facts → total collapse
  // ─────────────────────────────────────────
  if (missing) {
    return {
      integrityStatus: 'unknown',
      duplicationPresence: 'unknown',
    };
  }

  // ─────────────────────────────────────────
  // Duplication presence
  // ─────────────────────────────────────────
  const duplicationPresence =
    productsWithMultipleSkus > 0 ? 'present' : 'absent';

  // ─────────────────────────────────────────
  // Overall integrity status
  // ─────────────────────────────────────────
  const integrityStatus =
    productsWithConflictingFields > 0
      ? 'inconsistent'
      : 'consistent';

  return {
    integrityStatus,
    duplicationPresence,
  };
}