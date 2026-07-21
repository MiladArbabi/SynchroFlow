import { ActivationSurfaceState } from '../../activation/deriveActivationSurfaceState.js';
import { ActivationSurfaceProps } from './types.js';
/**
 * UI-level activation state.
 * This is the ONLY object the frontend should reason about.
 */
export type ActivationUIState = {
    state: 'BLOCKED';
    surface: ActivationSurfaceProps;
} | {
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
export declare function mapActivationSurfaceToUIState(activationSurface: ActivationSurfaceState, surfaceConfig: ActivationSurfaceProps, moduleId: string, onAction?: (actionId: string) => void): ActivationUIState;
//# sourceMappingURL=activation-mapper.d.ts.map