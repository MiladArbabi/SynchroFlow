import { AlignmentPlane, AlignmentResult } from "./alignmentPlane.types.js";
import { crossDomainTrustPlane } from "./crossDomainTrust.plane.js";
import { visibilityGate } from "./visibilityGate.js";

/**
 * Alignment Plane Engine
 * ---------------------
 * Executes META plane first, then registered planes.
 * Fails closed. Deterministic.
 */
export function executeAlignmentPlanes(
  metaInput: Parameters<typeof crossDomainTrustPlane.compute>[0],
  planes: Array<{ plane: AlignmentPlane<any>; input: any }>
): Record<string, AlignmentResult> {
  const results: Record<string, AlignmentResult> = {};

  // META plane executes first
  const trustResult = crossDomainTrustPlane.compute(metaInput);
  results[crossDomainTrustPlane.planeId] = trustResult;

  if (trustResult !== 'aligned') {
    // Short-circuit: all other planes unknown
    for (const { plane } of planes) {
      results[plane.planeId] = 'unknown';
    }
    return results;
  }

  // Visibility gate — epistemic boundary
  // UNKNOWN / INCOMPLETE visibility blocks execution
  if (!visibilityGate(metaInput.visibilities)) {
    for (const { plane } of planes) {
      results[plane.planeId] = 'unknown';
    }
    return results;
  }

  // Execute remaining planes (visibility-safe)
  for (const { plane, input } of planes) {
    results[plane.planeId] = plane.compute(input);
  }

  return results;
}
