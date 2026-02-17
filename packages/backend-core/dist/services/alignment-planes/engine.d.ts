import type { AlignmentPlane, AlignmentResult } from './alignmentPlane.types.js';
import { crossDomainTrustPlane } from './crossDomainTrust.plane.js';
/**
 * Alignment Plane Engine
 * ---------------------
 * Executes META plane first, then registered planes.
 * Fails closed. Deterministic.
 */
export declare function executeAlignmentPlanes(metaInput: Parameters<typeof crossDomainTrustPlane.compute>[0], planes: Array<{
    plane: AlignmentPlane<any>;
    input: any;
}>): Record<string, AlignmentResult>;
