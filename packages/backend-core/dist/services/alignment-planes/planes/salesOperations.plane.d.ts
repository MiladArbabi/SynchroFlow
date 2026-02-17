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
export declare const salesOperationsPlane: AlignmentPlane<{
    orders: {
        velocity: 'up' | 'down' | 'flat' | 'unknown' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
    fulfillment: {
        status: 'fulfilled' | 'partial' | 'unfulfilled' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
}>;
