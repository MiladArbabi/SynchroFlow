// modules/shared/src/ui/activation/activation-mapper.ts

import { ActivationVerdict } from '../../contracts/activation';
import { ActivationSurfaceProps } from './types';

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
 * Maps backend ActivationVerdict → UI-safe ActivationUIState
 *
 * Frontend must NEVER branch on ActivationVerdict directly.
 */
export function mapActivationVerdictToUIState(
  verdict: ActivationVerdict,
  surfaceConfig: ActivationSurfaceProps,
  onAction?: (actionId: string) => void
): ActivationUIState {
  switch (verdict.verdict) {
    case 'BLOCKED':
      return {
        state: 'BLOCKED',
        surface: {
          ...surfaceConfig,
          onAction,
        },
      };

    case 'INTEGRATION_COMPLETE_NOT_READY':
      console.log('[activation-mapper] BLOCKED mapped', {
          verdict: verdict.verdict,
          hasOnAction: Boolean(onAction),
        });
      return {
        state: 'BLOCKED',
        surface: {
          ...surfaceConfig,
          ...(surfaceConfig.identity && {
            identity: {
              ...surfaceConfig.identity,
              subtitle: 'Finish setup to unlock this module',
            },
          }),
          onAction,
        },
      };

    case 'ACTIVE':
      return {
        state: 'ACTIVE',
        active: true,
      };

    default: {
      // Exhaustiveness guard — compile-time safety
      const _exhaustive: never = verdict;
      return _exhaustive;
    }
  }
}