// packages/backend-core/src/config/tiers.ts
//
// Canonical Tier Constants (MON-01)
// ----------------------------------
// SINGLE SOURCE OF TRUTH for all subscription tiers.
//
// Referenced by:
//   - Stripe webhook handlers (MON-02)
//   - Entitlements engine / require-entitlement middleware (MON-03)
//   - Seat limit enforcement (MON-04)
//   - Order cap enforcement (MON-05)
//   - JWT tier claim issuance (MON-03)
//   - Frontend EntitlementsContext tier gating (MON-06)
//
// CHANGE POLICY:
//   Any change to module lists must be reflected in:
//     1. shop_module_entitlements seeding logic
//     2. Frontend tier-gating components
//     3. Stripe Price object IDs (if price changes)
//   Never derive tier membership from entitlement rows — always
//   derive entitlement rows FROM tier constants.
export const TIERS = ['starter', 'core', 'growth', 'scale'];
export const TIER_CONFIG = {
    /**
     * Starter (Free)
     * - 1 seat (owner only)
     * - 50 orders/month cap
     * - Core operational modules only
     */
    starter: {
        monthlyPriceCents: 0,
        seatLimit: 1,
        monthlyOrderCap: 50,
        modules: [
            'order-nexus', // Orders list + detail
            'fulfillment', // Fulfillment queue
            'alerts', // Operational alerts
            'shopify_integration',
            'specter_sdk_free',
        ],
        flags: [],
    },
    /**
     * Core ($79/month)
     * - 2 seats
     * - Unlimited orders
     * - Adds WMS-Lite, Returns, Products
     */
    core: {
        monthlyPriceCents: 7900,
        seatLimit: 2,
        monthlyOrderCap: Infinity,
        modules: [
            'order-nexus',
            'fulfillment',
            'alerts',
            'shopify_integration',
            'specter_sdk_free',
            'wms-lite', // MON-02: wired from FT2_PAID_MODULES
            'returns',
            'products',
        ],
        flags: [],
    },
    /**
     * Growth ($179/month)
     * - 5 seats
     * - Unlimited orders
     * - Adds intelligence modules: Cash Flow, LTV, Demand, Specter
     * - 14-day free trial on signup (MON-07)
     * - Annual billing available at 20% discount (MON-08)
     */
    growth: {
        monthlyPriceCents: 17900,
        seatLimit: 5,
        monthlyOrderCap: Infinity,
        modules: [
            'order-nexus',
            'fulfillment',
            'alerts',
            'shopify_integration',
            'specter_sdk_free',
            'wms-lite',
            'returns',
            'products',
            'customers',
            'finances', // Cash Flow
            'demand',
            'specter', // Full Specter (replaces specter_sdk_free)
            'echo-hub',
        ],
        flags: [
            'orders.advanced_filters',
            'customers.segmentation',
            'specter.full_capture',
        ],
    },
    /**
     * Scale ($349/month)
     * - Unlimited seats
     * - Unlimited orders
     * - Adds Floor Planning, Barcodes, WMS Advanced
     */
    scale: {
        monthlyPriceCents: 34900,
        seatLimit: Infinity,
        monthlyOrderCap: Infinity,
        modules: [
            'order-nexus',
            'fulfillment',
            'alerts',
            'shopify_integration',
            'specter_sdk_free',
            'wms-lite',
            'returns',
            'products',
            'customers',
            'finances',
            'demand',
            'specter',
            'echo-hub',
            'floor-planning',
            'barcodes',
            'wms', // WMS Advanced (full, supersedes wms-lite)
        ],
        flags: [
            'orders.advanced_filters',
            'customers.segmentation',
            'specter.full_capture',
        ],
    },
};
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
/**
 * Returns true if the given string is a valid Tier.
 */
export function isValidTier(value) {
    return TIERS.includes(value);
}
