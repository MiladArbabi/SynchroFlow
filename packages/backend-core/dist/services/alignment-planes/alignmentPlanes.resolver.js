import { executeAlignmentPlanes } from './engine.js';
import { alignmentPlaneRegistry } from './registry.js';
/**
 * Alignment Planes Resolver
 * ------------------------
 * Read-only orchestration layer.
 *
 * Rules:
 * - FT2 inputs only
 * - No DB access
 * - No persistence
 * - No interpretation
 */
export function resolveAlignmentPlanes(input) {
    const planesToExecute = input.planes
        .map(({ planeId, input }) => {
        const plane = alignmentPlaneRegistry.find(p => p.planeId === planeId);
        if (!plane)
            return null;
        return { plane, input };
    })
        .filter(Boolean);
    return executeAlignmentPlanes(input.meta, planesToExecute);
}
