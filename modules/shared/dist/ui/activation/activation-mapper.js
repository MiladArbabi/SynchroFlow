// modules/shared/src/ui/activation/activation-mapper.ts
import { buildActivationSurfaceProps } from './buildActivationSurfaceProps.js';
/**
 * Maps backend ActivationSurface → UI-safe ActivationUIState
 *
 * IMPORTANT:
 * - Frontend MUST NOT inspect ActivationVerdict anymore
 * - Backend fully owns activation decisions
 */
export function mapActivationSurfaceToUIState(activationSurface, surfaceConfig, moduleId, onAction) {
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
            ...buildActivationSurfaceProps(activationSurface, surfaceConfig, moduleId),
            onAction,
        },
    };
}
