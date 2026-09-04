export declare const TIERS: readonly ["starter", "core", "growth", "scale"];
export type Tier = (typeof TIERS)[number];
/** Canonical monotonic rank. starter < core < growth < scale. */
export declare const TIER_ORDER: Readonly<Record<Tier, number>>;
/** True when `actual` tier meets or exceeds `required`. Higher always wins. */
export declare function tierAtLeast(actual: Tier, required: Tier): boolean;
/** Narrowing guard — unknown strings are rejected (callers fail closed). */
export declare function isValidTier(value: unknown): value is Tier;
