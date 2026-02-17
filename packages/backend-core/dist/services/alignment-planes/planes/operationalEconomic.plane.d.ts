import type { AlignmentPlane } from '../alignmentPlane.types.js';
/**
 * Operational ↔ Economic Alignment Plane
 * --------------------------------------
 * Determines whether economic order signals
 * are grounded in operational reality.
 *
 * Rules:
 * - Visibility gates execution
 * - Unknown propagates
 * - No performance semantics
 * - No lifecycle meaning
 */
export declare const operationalEconomicPlane: AlignmentPlane<{
    orders: {
        outcome: 'positive' | 'negative' | null;
        visibility: 'sufficient' | 'insufficient' | null;
    };
    fulfillment: {
        operationalReality: 'real' | 'unreal' | 'unknown';
        visibility: 'sufficient' | 'insufficient' | null;
    };
}>;
