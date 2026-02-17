// modules/shared/src/activation/deriveActivationSurfaceState.ts

/**
 * Activation Surface State Derivation
 * ----------------------------------
 * Pure function.
 *
 * IMPORTANT:
 * - This file deals ONLY with activation + integration readiness.
 * - It MUST NOT infer or represent user lifecycle phases.
 * - FT0 here === technical integration readiness only.
 */

import type {
  ActivationSurfaceContext,
  ActivationVerdict,
  FT0Phase,
} from './types.js';

/**
 * UI-facing activation surface state.
 * This is the ONLY contract the frontend should consume.
 */
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
        phase: Extract<FT0Phase, 'SYNCING'>;
        isBlocking: true;
      };
    }
  | {
      state: 'READY_PENDING_MODULES';
      ft0: {
        phase: Extract<FT0Phase, 'COMPLETED'>;
        isBlocking: false;
      };
    }
  | {
      state: 'ACTIVE';
      primaryAction: { action: 'GO_TO_DASHBOARD' };
      ft0: {
        phase: Extract<FT0Phase, 'COMPLETED'>;
        isBlocking: false;
      };
    };

export function deriveActivationSurfaceState(input: {
  verdict: ActivationVerdict;
  context?: ActivationSurfaceContext;
}): ActivationSurfaceState {
  const { verdict } = input;

  // ─────────────────────────────────────────────
  // BLOCKED STATES
  // ─────────────────────────────────────────────
  if (verdict.verdict === 'BLOCKED') {
    switch (verdict.reason) {
      case 'NOT_AUTHENTICATED':
        return {
          state: 'BLOCKED_AUTH',
          primaryAction: { action: 'LOGIN' },
        };

      case 'NO_SHOP':
        return {
          state: 'BLOCKED_SHOP',
          primaryAction: { action: 'CONNECT_SHOP' },
        };

      case 'NO_INTEGRATION':
        return {
          state: 'CONNECT_INTEGRATION',
          primaryAction: { action: 'CONNECT_INTEGRATION' },
        };
    }
  }

  // ─────────────────────────────────────────────
  // PENDING STATES
  // ─────────────────────────────────────────────
  if (verdict.verdict === 'PENDING') {
    switch (verdict.reason) {
      case 'FT0_SYNCING':
        return {
          state: 'SYNC_IN_PROGRESS',
          progress: { phase: 'FT0' },
          ft0: {
            phase: 'SYNCING',
            isBlocking: true,
          },
        };

      case 'ENTITLEMENT_PENDING':
        return {
          state: 'READY_PENDING_MODULES',
          ft0: {
            phase: 'COMPLETED',
            isBlocking: false,
          },
        };
    }
  }

  // ─────────────────────────────────────────────
  // ACTIVE (DEFAULT SAFE FALLTHROUGH)
  // ─────────────────────────────────────────────
  return {
    state: 'ACTIVE',
    primaryAction: { action: 'GO_TO_DASHBOARD' },
    ft0: {
      phase: 'COMPLETED',
      isBlocking: false,
    },
  };
}
