// modules/shared/src/ui/activation/buildActivationSurfaceProps.ts

import { ActivationSurfaceState } from '../../activation/deriveActivationSurfaceState';
import { ActivationSurfaceProps } from './types';

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

  if (!('primaryAction' in state)) {
    throw new Error(
      `[buildActivationSurfaceProps] State ${state.state} has no primaryAction`
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
