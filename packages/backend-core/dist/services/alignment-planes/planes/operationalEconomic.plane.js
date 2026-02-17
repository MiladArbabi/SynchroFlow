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
export const operationalEconomicPlane = {
    planeId: 'operational-economic',
    compute({ orders, fulfillment }) {
        // Epistemic guard
        if (orders.visibility !== 'sufficient' ||
            fulfillment.visibility !== 'sufficient') {
            return 'unknown';
        }
        if (orders.outcome === null ||
            fulfillment.operationalReality === 'unknown') {
            return 'unknown';
        }
        // Economic signal backed by operations
        if (orders.outcome === 'positive' &&
            fulfillment.operationalReality === 'real') {
            return 'aligned';
        }
        // No economic success, no operational grounding required
        if (orders.outcome === 'negative' &&
            fulfillment.operationalReality === 'unreal') {
            return 'aligned';
        }
        return 'divergent';
    },
};
