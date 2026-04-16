export declare const TIERS: readonly ["starter", "core", "growth", "scale"];
export type Tier = (typeof TIERS)[number];
export interface TierConfig {
    /** Display price in USD cents/month. 0 = free. */
    monthlyPriceCents: number;
    /** Max operator seats. Infinity = unlimited. */
    seatLimit: number;
    /** Max orders ingested per calendar month. Infinity = unlimited. */
    monthlyOrderCap: number;
    /** Max orders shipped via WMS per billing period. Infinity = unlimited. Overage billed at $0.08/order. */
    shippedOrderCap: number;
    /** Max Specter sessions per billing period. Infinity = unlimited. Overage degrades to specter_sdk_free. */
    specterSessionCap: number;
    /**
     * Module keys granted to this tier.
     * Must match module_key values in shop_module_entitlements.
     * Each tier is CUMULATIVE — includes all lower-tier modules.
     */
    modules: readonly string[];
    /**
     * Flag keys granted to this tier.
     * Format: '<module_key>.<flag_name>'
     */
    flags: readonly string[];
}
export declare const TIER_CONFIG: Record<Tier, TierConfig>;
/**
 * Returns the TierConfig for a given tier.
 * Throws if tier is not recognized — fail loud, never silently degrade.
 */
export declare function getTierConfig(tier: Tier): TierConfig;
/**
 * Returns true if the given string is a valid Tier.
 */
export declare function isValidTier(value: unknown): value is Tier;
