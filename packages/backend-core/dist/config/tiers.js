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
// --- Cumulative module sets ---
// Each tier's modules are derived by spreading the previous tier.
// NEVER repeat module keys manually — add to the lowest tier that grants access.
// This eliminates drift: a module added to STARTER_MODULES is automatically
// available in all higher tiers.
const STARTER_MODULES = [
    'overview', // Morning brief + operational pulse
    'order-nexus', // Orders list + detail
    'fulfillment', // Fulfillment queue
    'alerts', // Operational alerts
    'shopify_integration',
    'specter_sdk_free',
];
const CORE_MODULES = [
    ...STARTER_MODULES,
    'wms', // WMS pick/pack/stow — receive, pick, pack, stow, LSU/LSO labels
    'barcodes', // LSU/LSO operational labels + warehouse location barcodes
    'returns',
    'products',
    'problem-center', // Product-side problem center — surfaces issues from WMS receive/pick/pack
];
const GROWTH_MODULES = [
    ...CORE_MODULES,
    'customers',
    'finances', // Cash Flow
    'demand',
    'specter', // Full Specter (supersedes specter_sdk_free)
    'echo-hub',
];
const SCALE_MODULES = [
    ...GROWTH_MODULES,
    'floor-planning', // Warehouse floor plan builder + location barcode generation
];
// --- Cumulative flag sets ---
const STARTER_FLAGS = [];
const CORE_FLAGS = [...STARTER_FLAGS];
const GROWTH_FLAGS = [
    ...CORE_FLAGS,
    'orders.advanced_filters',
    'customers.segmentation',
    'specter.full_capture',
    'returns.analysis', // Returns correlation + supplier trend analysis
    'problem-center.analytics', // Cross-module problem intelligence + trend reporting
];
const SCALE_FLAGS = [...GROWTH_FLAGS];
export const TIER_CONFIG = {
    /**
     * Starter (Free)
     * - 1 seat (owner only)
     * - 50 orders/month ingestion cap
     * - Core operational modules only
     */
    starter: {
        monthlyPriceCents: 0,
        seatLimit: 1,
        monthlyOrderCap: 50,
        shippedOrderCap: 0, // WMS not available on Starter
        specterSessionCap: 500,
        modules: STARTER_MODULES,
        flags: STARTER_FLAGS,
    },
    /**
     * Core ($79/month)
     * - 2 seats + extra seats at $15/seat/mo
     * - 2,000 orders ingested/mo — soft cap, degraded priority above limit
     * - 200 orders shipped via WMS/mo — overage at $0.08/order
     * - Adds WMS, Returns, Products
     */
    core: {
        monthlyPriceCents: 7900,
        seatLimit: 2,
        monthlyOrderCap: 2000,
        shippedOrderCap: 200,
        specterSessionCap: 5000,
        modules: CORE_MODULES,
        flags: CORE_FLAGS,
    },
    /**
     * Growth ($179/month)
     * - 5 seats + extra seats at $12/seat/mo
     * - 10,000 orders ingested/mo
     * - 1,000 orders shipped via WMS/mo — overage at $0.08/order
     * - Adds intelligence: Cash Flow, LTV, Demand, Specter
     * - 14-day free trial on signup (MON-07)
     * - Annual billing at 20% discount (MON-08)
     */
    growth: {
        monthlyPriceCents: 17900,
        seatLimit: 5,
        monthlyOrderCap: 10000,
        shippedOrderCap: 1000,
        specterSessionCap: 25000,
        modules: GROWTH_MODULES,
        flags: GROWTH_FLAGS,
    },
    /**
     * Scale ($349/month)
     * - Unlimited seats
     * - Unlimited orders ingested and shipped
     * - Adds Floor Planning, Barcodes, WMS Advanced
     */
    scale: {
        monthlyPriceCents: 34900,
        seatLimit: Infinity,
        monthlyOrderCap: Infinity,
        shippedOrderCap: Infinity,
        specterSessionCap: Infinity,
        modules: SCALE_MODULES,
        flags: SCALE_FLAGS,
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
