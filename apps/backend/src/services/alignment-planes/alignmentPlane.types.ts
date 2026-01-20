/**
 * Alignment Plane — Canonical Types
 * --------------------------------
 * Alignment planes classify compatibility between FT2 domains.
 * They do NOT own truth and MUST fail closed.
 */

export type AlignmentResult = 'aligned' | 'divergent' | 'unknown';

export interface AlignmentPlane<Input> {
  /**
   * Stable, explicit identifier.
   * Used for registry + exposure.
   */
  readonly id: string;

  /**
   * Compute alignment classification.
   * Must be pure and deterministic.
   */
  compute(input: Input): AlignmentResult;
}