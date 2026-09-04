import type { Tier as CanonicalTier, LegacyTierConfig } from '@lasyncro/commercial-policy';
export { TIERS, TIER_ORDER, tierAtLeast, } from '@lasyncro/commercial-policy';
export type Tier = CanonicalTier;
/** Historical shape kept for backward compatibility. */
export type TierConfig = LegacyTierConfig;
/** Frozen compatibility object — sourced from @lasyncro/commercial-policy. */
export declare const TIER_CONFIG: Record<Tier, TierConfig>;
/**
 * Returns the TierConfig for a given tier.
 * Throws if tier is not recognized — fail loud, never silently degrade.
 */
export declare function getTierConfig(tier: Tier): TierConfig;
export declare function tierHasFlag(tier: Tier, flag: string): boolean;
/** Returns true if the given string is a valid Tier. */
export declare function isValidTier(value: unknown): value is Tier;
