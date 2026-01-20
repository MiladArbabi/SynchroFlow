/**
 * Layer 3 — ProductDataIntegrityFT2Exposure
 *
 * FT2-safe, lossy exposure of product data integrity.
 *
 * RULES:
 * - No raw facts
 * - No intelligence internals
 * - No explanations or advice
 * - Null = truth withheld or unknown by policy
 */
export interface ProductDataIntegrityFT2Exposure {
  /**
   * Structural consistency of product representations.
   */
  integrity: 'ok' | 'attention' | 'unknown';

  /**
   * Presence of duplicate SKU representations.
   */
  duplication: 'present' | 'absent' | 'unknown';
}