export const orderVelocityFulfillmentPlane = {
    planeId: 'order-velocity-fulfillment',
    compute({ orders, fulfillment }) {
        // Fail-closed on epistemic uncertainty
        if (orders.visibility !== 'sufficient' ||
            fulfillment.visibility !== 'sufficient') {
            return 'unknown';
        }
        if (orders.velocity === 'unknown' ||
            orders.velocity === null ||
            fulfillment.operationalReality === 'unknown' ||
            fulfillment.operationalReality === null) {
            return 'unknown';
        }
        if (orders.velocity === 'up' && fulfillment.operationalReality === 'unreal') {
            return 'divergent';
        }
        if (orders.velocity === 'flat' && fulfillment.operationalReality === 'unreal') {
            return 'divergent';
        }
        return 'aligned';
    },
};
