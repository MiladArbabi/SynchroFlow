// modules/shared/src/activation/deriveActivationSurfaceState.ts

import { ActivationVerdict, FT0Phase } from './types';

export type ActivationSurfaceState =
  | {
      state: 'BLOCKED_AUTH';
      primaryAction: { action: 'LOGIN' };
    }
  | {
      state: 'BLOCKED_SHOP';
      primaryAction: { action: 'CONNECT_SHOP' };
    }
  | {
      state: 'CONNECT_INTEGRATION';
      primaryAction: { action: 'CONNECT_INTEGRATION' };
    }
  | {
      state: 'SYNC_IN_PROGRESS';
      progress: { phase: 'FT0' };
      ft0: {
        phase: 'SYNCING';
        isBlocking: true;
      };
    }
  | {
      state: 'READY_PENDING_MODULES';
      ft0: {
        phase: 'READY';
        isBlocking: false;
      };
    }
  | {
      state: 'ACTIVE';
      primaryAction: { action: 'GO_TO_DASHBOARD' };
      ft0: {
        phase: 'READY';
        isBlocking: false;
      };
    };


export function deriveActivationSurfaceState(input: {
  verdict: ActivationVerdict;
  ft0Phase: FT0Phase;
}): ActivationSurfaceState {
  const { verdict, ft0Phase } = input;

  // BLOCKED states
  if (verdict.verdict === 'BLOCKED') {
    if (verdict.reason === 'NOT_AUTHENTICATED') {
      return {
        state: 'BLOCKED_AUTH',
        primaryAction: { action: 'LOGIN' },
      };
    }

    if (verdict.reason === 'NO_SHOP') {
      return {
        state: 'BLOCKED_SHOP',
        primaryAction: { action: 'CONNECT_SHOP' },
      };
    }

    if (verdict.reason === 'NO_INTEGRATION') {
      return {
        state: 'CONNECT_INTEGRATION',
        primaryAction: { action: 'CONNECT_INTEGRATION' },
      };
    }
  }

  // PENDING states
  if (verdict.verdict === 'PENDING') {
    if (verdict.reason === 'FT0_SYNCING') {
      return {
        state: 'SYNC_IN_PROGRESS',
        progress: { phase: 'FT0' },
        ft0: {
          phase: 'SYNCING',
          isBlocking: true,
        },
      };
    }

    if (verdict.reason === 'ENTITLEMENT_PENDING') {
      return {
        state: 'READY_PENDING_MODULES',
        ft0: {
          phase: 'READY',
          isBlocking: false,
        },
      };
    }
  }

  // ACTIVE
  return {
    state: 'ACTIVE',
    primaryAction: { action: 'GO_TO_DASHBOARD' },
    ft0: {
      phase: 'READY',
      isBlocking: false,
    },
  };
}
