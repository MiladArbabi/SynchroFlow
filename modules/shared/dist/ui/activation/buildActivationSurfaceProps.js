// modules/shared/src/ui/activation/buildActivationSurfaceProps.ts
export function buildActivationSurfaceProps(state, config, moduleId) {
    if (state.state === 'ACTIVE') {
        throw new Error('[buildActivationSurfaceProps] ACTIVE state must not render ActivationSurface');
    }
    if (!config.primaryCTA) {
        throw new Error(`[buildActivationSurfaceProps] primaryCTA is required for state ${state.state}`);
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
