// modules/shared/src/ui/activation/buildActivationSurfaceProps.ts

import { ActivationSurfaceState } from '../../activation/deriveActivationSurfaceState.js';
import { ActivationSurfaceProps } from './types.js';

export function buildActivationSurfaceProps(
  state: ActivationSurfaceState,
  config: Omit<ActivationSurfaceProps, 'moduleId' | 'onAction'>,
  moduleId: string
): ActivationSurfaceProps {
  if (state.state === 'ACTIVE') {
    throw new Error(
      '[buildActivationSurfaceProps] ACTIVE state must not render ActivationSurface'
    );
  }

  if (!config.primaryCTA) {
    throw new Error(
      `[buildActivationSurfaceProps] primaryCTA is required for state ${state.state}`
    );
  }

  return {
    moduleId,
    identity: config.identity,
    blindness: config.blindness,
    absenceProof: config.absenceProof,
    valueAfterActivation: config.valueAfterActivation,
    trust: config.trust,

    primaryCTA: {
      label: config.primaryCTA.label,
      actionId: config.primaryCTA.actionId,
    },
  };
}
