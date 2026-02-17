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
export const shippingDelayFulfillmentCoherencePlane = {
    planeId: 'shipping-delay-fulfillment-coherence',
    compute({ fulfillment, shippingDelay }) {
        // Epistemic guard
        if (!fulfillment ||
            !shippingDelay ||
            fulfillment.visibility !== 'sufficient' ||
            shippingDelay.visibility !== 'sufficient' ||
            fulfillment.operationalReality === null ||
            fulfillment.operationalReality === 'unknown' ||
            shippingDelay.signal === null) {
            return 'unknown';
        }
        // Delay without real fulfillment execution
        if (fulfillment.operationalReality === 'unreal' &&
            shippingDelay.signal === 'present') {
            return 'divergent';
        }
        return 'aligned';
    },
};
