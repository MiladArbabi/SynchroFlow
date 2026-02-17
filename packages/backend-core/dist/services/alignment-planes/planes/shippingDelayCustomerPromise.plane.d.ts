import type { AlignmentPlane } from '../alignmentPlane.types.js';
/**
 * Shipping Delay ↔ Customer Promise Alignment Plane
 * ------------------------------------------------
 * Classifies coherence between:
 * - Observed shipping delay signals
 * - Presence of an explicit customer delivery promise
 *
 * Questions answered:
 * - Is a delay occurring where a promise exists?
 *
 * Semantics:
 * - No promise → delay cannot violate anything
 * - Promise + delay → divergence
 *
 * No SLA timing.
 * No duration comparison.
 * No blame.
 * Fail-closed by default.
 */
export declare const shippingDelayCustomerPromisePlane: AlignmentPlane<{
    shippingDelay: {
        signal: 'present' | 'absent' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
    customerPromise: {
        signal: 'present' | 'absent' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
}>;
