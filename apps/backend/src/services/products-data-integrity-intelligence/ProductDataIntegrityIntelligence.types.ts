/**
 * Layer 2 — ProductDataIntegrityIntelligence
 *
 * Internal-only classification derived from
 * ProductDataIntegrityFacts.
 *
 * This layer:
 * - MAY classify
 * - MUST be deterministic
 * - MUST collapse to 'unknown' if facts are missing
 *
 * This layer NEVER:
 * - accesses persistence
 * - explains causes
 * - suggests actions
 * - leaks beyond FTEP
 */
export interface ProductDataIntegrityIntelligence {
  /**
   * Overall structural integrity of product representations.
   */
  integrityStatus: 'consistent' | 'inconsistent' | 'unknown';

  /**
   * Presence of duplicate SKU representations
   * for a single canonical product.
   */
  duplicationPresence: 'present' | 'absent' | 'unknown';
}