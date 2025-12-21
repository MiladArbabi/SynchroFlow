// apps/backend/src/api/activation/activation.surface.ts

import {
  ActivationVerdict,
  IdentitySnapshot,
  IntegrationSnapshot,
  EntitlementSnapshot,
} from '@lasyncro/shared/activation';
import { deriveActivationSurfaceState } from '@lasyncro/shared/activation/deriveActivationSurfaceState';
import { FT0Phase } from '@lasyncro/shared/activation';

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
  ft0Phase: FT0Phase;
}) {
  return deriveActivationSurfaceState({
    verdict: input.verdict,
    ft0Phase: input.ft0Phase,
  });
}