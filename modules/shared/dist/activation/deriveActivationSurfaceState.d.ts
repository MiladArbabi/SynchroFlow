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
import type { ActivationSurfaceContext, ActivationVerdict, FT0Phase } from './types.js';
/**
 * UI-facing activation surface state.
 * This is the ONLY contract the frontend should consume.
 */
export type ActivationSurfaceState = {
    state: 'BLOCKED_AUTH';
    primaryAction: {
        action: 'LOGIN';
    };
} | {
    state: 'BLOCKED_SHOP';
    primaryAction: {
        action: 'CONNECT_SHOP';
    };
} | {
    state: 'CONNECT_INTEGRATION';
    primaryAction: {
        action: 'CONNECT_INTEGRATION';
    };
} | {
    state: 'SYNC_IN_PROGRESS';
    progress: {
        phase: 'FT0';
    };
    ft0: {
        phase: Extract<FT0Phase, 'SYNCING'>;
        isBlocking: true;
    };
} | {
    state: 'READY_PENDING_MODULES';
    ft0: {
        phase: Extract<FT0Phase, 'COMPLETED'>;
        isBlocking: false;
    };
} | {
    state: 'ACTIVE';
    primaryAction: {
        action: 'GO_TO_DASHBOARD';
    };
    ft0: {
        phase: Extract<FT0Phase, 'COMPLETED'>;
        isBlocking: false;
    };
};
export declare function deriveActivationSurfaceState(input: {
    verdict: ActivationVerdict;
    context?: ActivationSurfaceContext;
}): ActivationSurfaceState;
//# sourceMappingURL=deriveActivationSurfaceState.d.ts.map