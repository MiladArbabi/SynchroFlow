import { AlignmentPlane } from './alignmentPlane.types.js';
/**
 * Demand Reality Plane
 * -------------------
 * Customers ↔ Orders
 *
 * Classifies whether customer engagement
 * manifests as economically observed orders.
 *
 * FT2-only. Deterministic. Fail-closed.
 */
export interface DemandRealityInput {
    customers: {
        engagementTrend: 'up' | 'down' | 'flat' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
    orders: {
        trend: 'up' | 'down' | 'flat' | null;
        outcome: 'positive' | 'negative' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
}
export declare const demandRealityPlane: AlignmentPlane<DemandRealityInput>;
