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
export const shippingFulfillmentCoherencePlane: AlignmentPlane<{
  fulfillment: {
    operationalReality: 'real' | 'unreal' | 'unknown' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
  shipping: {
    signal: 'present' | 'absent' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
}> = {
  planeId: 'shipping-fulfillment-coherence',

  compute({ fulfillment, shipping }) {
    // Epistemic guard
    if (
        fulfillment.visibility !== 'sufficient' ||
        shipping.visibility !== 'sufficient'
    ) {
        return 'unknown';
    }

    if (
        fulfillment.operationalReality === 'unknown' ||
        fulfillment.operationalReality === null ||
        shipping.signal === null
    ) {
        return 'unknown';
    }

    if (
      fulfillment.operationalReality === 'real' &&
      shipping.signal === 'absent'
    ) {
      return 'divergent';
    }

    if (
      fulfillment.operationalReality === 'unreal' &&
      shipping.signal === 'present'
    ) {
      return 'divergent';
    }

    return 'aligned';
  },
};
