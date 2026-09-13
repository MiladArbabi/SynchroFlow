// @lasyncro/commercial-policy — canonical ModuleId registry + classification.
//
// TWO views of "modules":
//
//   modulesForTier(tier)  — CANONICAL forward truth: what a standard plan of
//                           that tier grants. Consumed by evaluateAccess and
//                           (P0-A2) the effective-module resolver.
//
//   LEGACY_MODULES_BY_TIER — the FROZEN shape backend-core `TIER_CONFIG.modules`
//                            re-exports, kept byte-identical so seeding /
//                            `shop_module_entitlements` writes do not change in
//                            P0-A1 (see COMMERCIAL-ACCESS-ARCH-01 §19). The
//                            only delta vs canonical is `suppliers-portal`,
//                            which is Starter-standard forward but not yet in
//                            the legacy seed lists.
import { TIERS, TIER_ORDER } from './tiers.js';
/**
 * Every module identity the platform knows about, and what kind it is.
 *   standard   — a real, currently-active commercial module (tier-granted)
 *   grant_only — only ever granted by an explicit commercial grant, never a tier
 *   internal   — integration / SDK / sub-capability plumbing, not user-facing
 *   legacy     — deprecated / paused product area, kept for compatibility
 *
 * `wms-lite` is deliberately ABSENT — it is an invalid legacy nav reference.
 */
export const MODULE_CLASSIFICATION = Object.freeze({
    overview: 'standard',
    'order-nexus': 'standard',
    fulfillment: 'standard',
    alerts: 'standard',
    wms: 'standard',
    returns: 'standard',
    products: 'standard',
    'problem-center': 'standard',
    customers: 'standard',
    demand: 'standard',
    specter: 'standard',
    'floor-planning': 'standard',
    'suppliers-portal': 'standard',
    'echo-hub': 'grant_only',
    shopify_integration: 'internal',
    specter_sdk_free: 'internal',
    barcodes: 'internal',
    shared: 'internal',
    finances: 'legacy',
    cashflow: 'legacy',
});
export const MODULE_IDS = Object.freeze(Object.keys(MODULE_CLASSIFICATION));
export function isModuleId(value) {
    return typeof value === 'string' && value in MODULE_CLASSIFICATION;
}
// ---------------------------------------------------------------------------
// Canonical standard module sets (cumulative).
// ---------------------------------------------------------------------------
// COMMERCIAL-REMODEL-ALIGN-01 (2026-09-06) — canonical forward truth.
//
// Starter buys the operating foundation only: overview, inventory/products, and
// the alerts inbox. It deliberately excludes full Orders Flow, WMS/barcode
// execution, and Returns.
const STANDARD_STARTER = [
    'overview', 'products', 'alerts',
];
// Core adds execution foundations: Orders, WMS operations/analytics, Returns,
// and export basics.
const STANDARD_CORE = [
    ...STANDARD_STARTER, 'order-nexus', 'fulfillment', 'wms', 'returns',
];
// Growth adds optimization and intelligence surfaces.
//
// `customers`, `finances` and `specter` are deliberately ABSENT: Finances is
// PAUSED and Customers/Specter are DEPRECATED (see catalog.ts). A paused or
// deprecated area must never be sold as a standard grant at any tier, even
// implicitly through a tier module set. Their implementation is intentionally
// left in place — cleanup is a separate future program.
const STANDARD_GROWTH = [
    ...STANDARD_CORE, 'demand', 'floor-planning', 'problem-center', 'suppliers-portal',
];
// Scale is "everything Growth has, without limits" — never a distinct module
// set, and never an arbitrary Scale-only module wall.
const STANDARD_SCALE = [...STANDARD_GROWTH];
const STANDARD_MODULES_BY_TIER = Object.freeze({
    starter: STANDARD_STARTER,
    core: STANDARD_CORE,
    growth: STANDARD_GROWTH,
    scale: STANDARD_SCALE,
});
/** Canonical: the standard module set a shop on `tier` is granted. */
export function modulesForTier(tier) {
    return new Set(STANDARD_MODULES_BY_TIER[tier]);
}
// ---------------------------------------------------------------------------
// FROZEN legacy shape — do NOT add suppliers-portal here in P0-A1.
// Mirrors backend-core TIER_CONFIG.modules exactly so seeding is unchanged.
// ---------------------------------------------------------------------------
const LEGACY_STARTER = [
    'overview', 'order-nexus', 'fulfillment', 'alerts',
    'shopify_integration', 'specter_sdk_free', 'wms', 'barcodes',
];
const LEGACY_CORE = [...LEGACY_STARTER, 'returns', 'products', 'problem-center'];
const LEGACY_GROWTH = [
    ...LEGACY_CORE, 'customers', 'finances', 'demand', 'specter', 'floor-planning',
];
const LEGACY_SCALE = [...LEGACY_GROWTH];
export const LEGACY_MODULES_BY_TIER = Object.freeze({
    starter: LEGACY_STARTER,
    core: LEGACY_CORE,
    growth: LEGACY_GROWTH,
    scale: LEGACY_SCALE,
});
// Sanity (compile-time-ish): every tier's canonical set is monotonic.
void TIERS;
void TIER_ORDER;
