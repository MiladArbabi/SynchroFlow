// apps/backend/src/services/alignment-planes/planes/shippingDelayCustomerPromise.plane.ts
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
export const shippingDelayCustomerPromisePlane: AlignmentPlane<{
  shippingDelay: {
    signal: 'present' | 'absent' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
  customerPromise: {
    signal: 'present' | 'absent' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
}> = {
  planeId: 'shipping-delay-customer-promise',

  compute({ shippingDelay, customerPromise }) {
    // Epistemic guard
    if (
      !shippingDelay ||
      !customerPromise ||
      shippingDelay.visibility !== 'sufficient' ||
      customerPromise.visibility !== 'sufficient' ||
      shippingDelay.signal === null ||
      customerPromise.signal === null
    ) {
      return 'unknown';
    }

    // Delay where a promise exists
    if (
      customerPromise.signal === 'present' &&
      shippingDelay.signal === 'present'
    ) {
      return 'divergent';
    }

    return 'aligned';
  },
};
