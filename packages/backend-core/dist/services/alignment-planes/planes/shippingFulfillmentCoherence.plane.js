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
export const shippingFulfillmentCoherencePlane = {
    planeId: 'shipping-fulfillment-coherence',
    compute({ fulfillment, shipping }) {
        // Epistemic guard
        if (fulfillment.visibility !== 'sufficient' ||
            shipping.visibility !== 'sufficient') {
            return 'unknown';
        }
        if (fulfillment.operationalReality === 'unknown' ||
            fulfillment.operationalReality === null ||
            shipping.signal === null) {
            return 'unknown';
        }
        if (fulfillment.operationalReality === 'real' &&
            shipping.signal === 'absent') {
            return 'divergent';
        }
        if (fulfillment.operationalReality === 'unreal' &&
            shipping.signal === 'present') {
            return 'divergent';
        }
        return 'aligned';
    },
};
