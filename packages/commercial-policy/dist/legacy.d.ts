import type { Tier } from './tiers.js';
export interface LegacyTierConfig {
    monthlyPriceCents: number;
    seatLimit: number;
    monthlyOrderCap: number;
    shippedOrderCap: number;
    specterSessionCap: number;
    modules: readonly string[];
    flags: readonly string[];
}
export declare const LEGACY_FLAGS_BY_TIER: Readonly<Record<Tier, readonly string[]>>;
export declare const LEGACY_TIER_CONFIG: Readonly<Record<Tier, LegacyTierConfig>>;
