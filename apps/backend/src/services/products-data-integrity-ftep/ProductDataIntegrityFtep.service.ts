import {
  ProductDataIntegrityIntelligence,
} from '../products-data-integrity-intelligence/ProductDataIntegrityIntelligence.types.js';
import {
  ProductDataIntegrityFT2Exposure,
} from './ProductDataIntegrityFtep.types.js';

interface BuildProductDataIntegrityFtepInput {
  intelligence: ProductDataIntegrityIntelligence;
}

/**
 * buildProductDataIntegrityFtep
 *
 * Truth Exposure Policy for Product Data Integrity (FT2-Paid).
 *
 * SECURITY ROLE:
 * - Acts as the downgrade boundary between intelligence and UI
 * - Prevents semantic leakage
 *
 * MANDATORY RULES:
 * - If intelligence is 'unknown' → exposure = null
 * - No raw counts
 * - No causal language
 * - No recommendations
 */
export function buildProductDataIntegrityFtep(
  input: BuildProductDataIntegrityFtepInput
): ProductDataIntegrityFT2Exposure | null {
  const { intelligence } = input;

  // ─────────────────────────────────────────
  // Total downgrade on unknown intelligence
  // ─────────────────────────────────────────
  if (
    intelligence.integrityStatus === 'unknown' ||
    intelligence.duplicationPresence === 'unknown'
  ) {
    return null;
  }

  /**
   * Lossy, policy-safe downgrades.
   *
   * NOTE:
   * - These are NOT interpretations
   * - They intentionally discard magnitude and cause
   */
  return {
    integrity:
      intelligence.integrityStatus === 'consistent'
        ? 'ok'
        : 'attention',

    duplication:
      intelligence.duplicationPresence === 'present'
        ? 'present'
        : 'absent',
  };
}