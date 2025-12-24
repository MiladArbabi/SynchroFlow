// apps/backend/src/api/activation/activation.surface.ts

import {
  ActivationVerdict,
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
} from '@lasyncro/shared/activation';
import { deriveActivationSurfaceState } from '@lasyncro/shared/activation/deriveActivationSurfaceState';

/**
 * Backend → UI adapter
 * --------------------
 * Produces a UI-safe activationSurface object.
 *
 * Rules:
 * - No UI logic here
 * - No React concepts
 * - No branching outside shared derivation
 */
export function buildActivationSurface(input: {
  verdict: ActivationVerdict;
}) {
  return deriveActivationSurfaceState({
    verdict: input.verdict,
  });
}