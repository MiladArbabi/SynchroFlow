import type { AlignmentPlane } from '../alignmentPlane.types.js';

/**
 * Sales ↔ Operations Alignment Plane
 * ----------------------------------
 * Classifies compatibility between:
 * - Order intake velocity
 * - Fulfillment execution capacity
 *
 * No forecasting.
 * No SLA timing.
 * No causality.
 * Fail-closed by default.
 */
export const salesOperationsPlane: AlignmentPlane<{
  orders: {
    velocity: 'up' | 'down' | 'flat' | 'unknown' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
  fulfillment: {
    status: 'fulfilled' | 'partial' | 'unfulfilled' | null;
    visibility: 'sufficient' | 'insufficient' | null;
  };
}> = {
  planeId: 'sales-operations',

  compute({ orders, fulfillment }) {
    // Epistemic guard
    if (
      orders.visibility !== 'sufficient' ||
      fulfillment.visibility !== 'sufficient'
    ) {
      return 'unknown';
    }

    if (
      orders.velocity === null ||
      orders.velocity === 'unknown' ||
      fulfillment.status === null
    ) {
      return 'unknown';
    }

    // Sales pressure without execution capacity
    if (
      orders.velocity === 'up' &&
      fulfillment.status !== 'fulfilled'
    ) {
      return 'divergent';
    }

    return 'aligned';
  },
};