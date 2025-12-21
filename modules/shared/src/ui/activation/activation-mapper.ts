// modules/shared/src/ui/activation/activation-mapper.ts

import { ActivationSurfaceState } from '../../activation/deriveActivationSurfaceState';
import { ActivationSurfaceProps } from './types';
import { buildActivationSurfaceProps } from './buildActivationSurfaceProps';

/**
 * UI-level activation state.
 * This is the ONLY object the frontend should reason about.
 */
export type ActivationUIState =
  | {
      state: 'BLOCKED';
      surface: ActivationSurfaceProps;
    }
  | {
      state: 'ACTIVE';
      active: true;
    };

/**
 * Maps backend ActivationSurface → UI-safe ActivationUIState
 *
 * IMPORTANT:
 * - Frontend MUST NOT inspect ActivationVerdict anymore
 * - Backend fully owns activation decisions
 */
export function mapActivationSurfaceToUIState(
  activationSurface: ActivationSurfaceState,
  surfaceConfig: ActivationSurfaceProps,
  moduleId: string,
  onAction?: (actionId: string) => void
): ActivationUIState {
  if (activationSurface.state === 'ACTIVE') {
    return {
      state: 'ACTIVE',
      active: true,
    };
  }

  // BLOCKED or PENDING → show surface config
  return {
    state: 'BLOCKED',
    surface: {
      ...buildActivationSurfaceProps(
        activationSurface,
        surfaceConfig,
        moduleId
      ),
      onAction,
    },
  };
}