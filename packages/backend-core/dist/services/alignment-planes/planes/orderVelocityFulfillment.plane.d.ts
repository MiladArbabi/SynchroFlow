import type { AlignmentPlane } from '../alignmentPlane.types.js';
export declare const orderVelocityFulfillmentPlane: AlignmentPlane<{
    orders: {
        velocity: 'up' | 'down' | 'flat' | 'unknown' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
    fulfillment: {
        operationalReality: 'real' | 'unreal' | 'unknown' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
}>;
