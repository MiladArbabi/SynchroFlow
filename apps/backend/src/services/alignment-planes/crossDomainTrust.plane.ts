import { AlignmentPlane, AlignmentResult } from './alignmentPlane.types';

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
  id: 'cross-domain-trust',

  compute(input): AlignmentResult {
    const { visibilities } = input;

    if (visibilities.some(v => v === null)) {
      return 'unknown';
    }

    if (visibilities.some(v => v === 'insufficient')) {
      return 'divergent';
    }

    return 'aligned';
  },
};
