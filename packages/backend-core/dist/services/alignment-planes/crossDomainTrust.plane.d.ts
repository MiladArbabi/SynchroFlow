import { AlignmentPlane } from './alignmentPlane.types.js';
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
export declare const crossDomainTrustPlane: AlignmentPlane<CrossDomainTrustInput>;
