import { AlignmentPlane, AlignmentResult } from './alignmentPlane.types.js';

/**
 * Cross-Domain Trust Plane (META)
 * -------------------------------
 * Determines whether participating domains
 * are epistemically comparable.
 *
 * HARD RULES:
 * - null         → unknown
 * - insufficient → divergent
 * - all sufficient → aligned
 *
 * This plane executes FIRST and may short-circuit all others.
 */
export interface CrossDomainTrustInput {
  visibilities: Array<'sufficient' | 'insufficient' | null>;
}

export const crossDomainTrustPlane: AlignmentPlane<CrossDomainTrustInput> = {
  planeId: 'cross-domain-trust',

  compute(input): AlignmentResult {
    const { visibilities } = input;

    // No signals → cannot assess trust
    if (visibilities.length === 0) {
      return 'unknown';
    }

    // Any null → epistemically unknown
    if (visibilities.some(v => v === null)) {
      return 'unknown';
    }

    const hasSufficient = visibilities.some(v => v === 'sufficient');
    const hasInsufficient = visibilities.some(v => v === 'insufficient');

    // Mixed epistemic states → divergent
    if (hasSufficient && hasInsufficient) {
      return 'divergent';
    }

    // All sufficient → trusted
    if (hasSufficient) {
      return 'aligned';
    }

    // All insufficient → unusable, not contradictory
    return 'unknown';
  }
};
