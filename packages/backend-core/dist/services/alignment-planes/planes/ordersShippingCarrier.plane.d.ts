import type { AlignmentPlane } from '../alignmentPlane.types.js';
/**
 * Orders ↔ Shipping Carrier Alignment Plane
 * -----------------------------------------
 * Classifies coherence between:
 * - Order fulfillment execution status
 * - Carrier shipping signal presence
 *
 * No delivery semantics.
 * No timing inference.
 * Fail-closed.
 */
export declare const ordersShippingCarrierPlane: AlignmentPlane<{
    orders: {
        fulfillmentStatus: 'fulfilled' | 'partial' | 'unfulfilled' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
    shipping: {
        signal: 'present' | 'absent' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
}>;
