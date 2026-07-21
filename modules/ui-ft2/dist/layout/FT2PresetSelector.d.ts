import type { FT2DateRangePreset } from '../contracts/ft2DateRange.js';
export interface FT2PresetSelectorProps {
    preset: FT2DateRangePreset;
    onSelect: (preset: FT2DateRangePreset) => void;
}
export declare function FT2PresetSelector({ preset, onSelect, }: FT2PresetSelectorProps): import("react/jsx-runtime").JSX.Element;
