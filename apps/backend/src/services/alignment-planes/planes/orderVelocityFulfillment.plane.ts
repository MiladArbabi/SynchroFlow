import type { AlignmentPlane } from '../alignmentPlane.types';

export const orderVelocityFulfillmentPlane: AlignmentPlane<{
  orders: {
    velocity: 'up' | 'down' | 'flat' | 'unknown' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
  fulfillment: {
    operationalReality: 'real' | 'unreal' | 'unknown' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
}> = {
  planeId: 'order-velocity-fulfillment',

  compute({ orders, fulfillment }) {
    // Fail-closed on epistemic uncertainty
    if (
        orders.visibility !== 'sufficient' ||
        fulfillment.visibility !== 'sufficient'
    ) {
        return 'unknown';
    }

    if (
        orders.velocity === 'unknown' ||
        orders.velocity === null ||
        fulfillment.operationalReality === 'unknown' ||
        fulfillment.operationalReality === null
    ) {
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
