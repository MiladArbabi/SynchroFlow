import type { Tier } from '../config/tiers.js';
export type FT2DateRangePreset = 'today' | 'this_week' | 'last_week' | 'past_7_days' | 'this_month' | 'last_month' | 'past_30_days' | 'custom';
type ResolveFt2PeriodInput = {
    preset: Exclude<FT2DateRangePreset, 'custom'>;
} | {
    preset: 'custom';
    from: string;
    to: string;
};
export type FT2RangeInput = FT2DateRangePreset | {
    preset: 'custom';
    from: string;
    to: string;
};
export declare function resolveFt2Range(range: FT2RangeInput, tier?: Tier): {
    from: string;
    to: string;
};
export declare function resolveFt2PeriodFromPreset(input: ResolveFt2PeriodInput): {
    from: string;
    to: string;
};
export declare function getFt2Period(): {
    from: string;
    to: string;
};
export {};
