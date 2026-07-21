export function ft2PresetReducer(state, event) {
    switch (event.type) {
        case 'SELECT_PRESET': {
            if (event.preset === 'custom') {
                return { kind: 'custom' };
            }
            return {
                kind: 'semantic',
                preset: event.preset,
            };
        }
        case 'CANCEL_CUSTOM': {
            return {
                kind: 'semantic',
                preset: 'past_30_days',
            };
        }
        default:
            return state;
    }
}
//# sourceMappingURL=FT2PresetSelector.state.js.map