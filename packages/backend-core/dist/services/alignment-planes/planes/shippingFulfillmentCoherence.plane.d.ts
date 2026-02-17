import type { AlignmentPlane } from '../alignmentPlane.types.js';
/**
 * Shipping ↔ Fulfillment Coherence Plane
 * -------------------------------------
 * Classifies structural coherence between:
 * - Fulfillment operational reality
 * - Shipping execution presence
 *
 * No delivery semantics.
 * No timing inference.
 * Fail-closed by default.
 */
export declare const shippingFulfillmentCoherencePlane: AlignmentPlane<{
    fulfillment: {
        operationalReality: 'real' | 'unreal' | 'unknown' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
    shipping: {
        signal: 'present' | 'absent' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
}>;
