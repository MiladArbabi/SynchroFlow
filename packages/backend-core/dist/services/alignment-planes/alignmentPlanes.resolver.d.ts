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
export declare function resolveAlignmentPlanes(input: {
    meta: {
        visibilities: Array<'sufficient' | 'insufficient' | null>;
    };
    planes: Array<{
        planeId: string;
        input: any;
    }>;
}): Record<string, 'aligned' | 'divergent' | 'unknown'>;
