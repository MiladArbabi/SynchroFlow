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
export const ordersShippingCarrierPlane = {
    planeId: 'orders-shipping-carrier',
    compute({ orders, shipping }) {
        // Epistemic guard
        if (!orders ||
            !shipping ||
            orders.visibility !== 'sufficient' ||
            shipping.visibility !== 'sufficient' ||
            orders.fulfillmentStatus === null ||
            shipping.signal === null) {
            return 'unknown';
        }
        if ((orders.fulfillmentStatus === 'fulfilled' ||
            orders.fulfillmentStatus === 'partial') &&
            shipping.signal === 'absent') {
            return 'divergent';
        }
        if (orders.fulfillmentStatus === 'unfulfilled' &&
            shipping.signal === 'present') {
            return 'divergent';
        }
        return 'aligned';
    },
};
