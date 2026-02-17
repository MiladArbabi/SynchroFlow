import { AlignmentPlane } from '../alignmentPlane.types.js';
type EngagementRevenueInput = {
    customers: {
        engagementTrend: 'up' | 'down' | 'flat' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
    orders: {
        outcome: 'positive' | 'negative' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
};
export declare const engagementRevenuePlane: AlignmentPlane<EngagementRevenueInput>;
export {};
