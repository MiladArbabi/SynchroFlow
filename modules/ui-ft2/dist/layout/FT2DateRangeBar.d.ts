import type { FT2DateRange } from '../contracts/ft2DateRange.js';
export interface FT2DateRangeBarProps {
    value: FT2DateRange;
    onChange: (range: FT2DateRange) => void;
}
export declare function FT2DateRangeBar({ value, onChange, }: FT2DateRangeBarProps): import("react/jsx-runtime").JSX.Element;
