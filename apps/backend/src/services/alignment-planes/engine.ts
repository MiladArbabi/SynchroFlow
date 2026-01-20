import type { AlignmentPlane, AlignmentResult } from './alignmentPlane.types';
import { crossDomainTrustPlane } from './crossDomainTrust.plane';
import { visibilityGate } from './visibilityGate';

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
  results[crossDomainTrustPlane.id] = trustResult;

  if (trustResult !== 'aligned') {
    // Short-circuit: all other planes unknown
    for (const { plane } of planes) {
      results[plane.id] = 'unknown';
    }
    return results;
  }

    // Visibility gate — hard epistemic boundary
  if (!visibilityGate(metaInput.visibilities)) {
    for (const { plane } of planes) {
      results[plane.id] = 'unknown';
    }
    return results;
  }

  // Execute remaining planes (visibility-safe)
  for (const { plane, input } of planes) {
    results[plane.id] = plane.compute(input);
  }

  return results;
}
