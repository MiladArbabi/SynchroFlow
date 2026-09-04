// packages/backend-core/src/config/tiers.ts
//
// Tier Constants — COMPATIBILITY LAYER (COMMERCIAL-ACCESS-ARCH-01 P0-A1)
// --------------------------------------------------------------------
// The canonical source of tier identity, rank, plan limits, modules, features
// and access policy is now `@lasyncro/commercial-policy` (a pure, zero-runtime-
// dependency, isomorphic package). backend-core no longer OWNS these values —
// it re-exports them, plus a frozen `TIER_CONFIG` compatibility object for its
// existing consumers (Stripe/Shopify webhooks, require-entitlement middleware,
// seat/order caps, JWT tier claim, seeds).
//
// Public API is unchanged: Tier, TIERS, TierConfig, TIER_CONFIG, getTierConfig,
// tierHasFlag, isValidTier. Callers migrate to the commercial-policy engine
// (evaluateAccess / CAPABILITY_REQUIREMENTS / modulesForTier) in P0-A2/A3.
//
// NOTE: `TIER_CONFIG.modules` is the FROZEN legacy seed shape. It intentionally
// still omits `suppliers-portal`, which is Starter-standard in the canonical
// `modulesForTier()` — kept divergent so `shop_module_entitlements` seeding is
// byte-identical in P0-A1 (see COMMERCIAL-ACCESS-ARCH-01 §19). Do not "fix" it here.
import { LEGACY_TIER_CONFIG, isValidTier as canonicalIsValidTier, } from '@lasyncro/commercial-policy';
export { TIERS, TIER_ORDER, tierAtLeast, } from '@lasyncro/commercial-policy';
/** Frozen compatibility object — sourced from @lasyncro/commercial-policy. */
export const TIER_CONFIG = LEGACY_TIER_CONFIG;
/**
 * Returns the TierConfig for a given tier.
 * Throws if tier is not recognized — fail loud, never silently degrade.
 */
export function getTierConfig(tier) {
    const config = TIER_CONFIG[tier];
    if (!config) {
        throw new Error(`[tiers] Unrecognized tier: "${tier}"`);
    }
    return config;
}
export function tierHasFlag(tier, flag) {
    return TIER_CONFIG[tier].flags.includes(flag);
}
/** Returns true if the given string is a valid Tier. */
export function isValidTier(value) {
    return canonicalIsValidTier(value);
}
