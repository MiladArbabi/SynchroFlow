import type { AlignmentPlane } from '../alignmentPlane.types.js';
/**
 * Shipping Delay ↔ Fulfillment Coherence Plane
 * --------------------------------------------
 * Classifies structural coherence between:
 * - Observed fulfillment execution
 * - Presence of shipping delay signals
 *
 * Semantics:
 * - Fulfillment = real  → delay may exist
 * - Fulfillment = unreal → delay must NOT exist
 *
 * No SLA.
 * No duration.
 * No blame.
 * Fail-closed by default.
 */
export declare const shippingDelayFulfillmentCoherencePlane: AlignmentPlane<{
    fulfillment: {
        operationalReality: 'real' | 'unreal' | 'unknown' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
    shippingDelay: {
        signal: 'present' | 'absent' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
}>;
