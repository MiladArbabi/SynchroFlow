import type { FT2DateRangePreset } from '../contracts/ft2DateRange.js';
export type SemanticPreset = Exclude<FT2DateRangePreset, 'custom'>;
export type FT2PresetSelectorState = {
    kind: 'semantic';
    preset: SemanticPreset;
} | {
    kind: 'custom';
};
export type FT2PresetEvent = {
    type: 'SELECT_PRESET';
    preset: FT2DateRangePreset;
} | {
    type: 'CANCEL_CUSTOM';
};
export declare function ft2PresetReducer(state: FT2PresetSelectorState, event: FT2PresetEvent): FT2PresetSelectorState;
