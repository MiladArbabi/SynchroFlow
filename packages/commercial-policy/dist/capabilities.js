// @lasyncro/commercial-policy — canonical ACTIVE capability registry.
//
// Exactly the ratified active capabilities (COMMERCIAL-ACCESS-ARCH-01 P0-A1).
// Each CapabilityId resolves to EXACTLY ONE non-contradictory AccessRequirement.
// No `openDecision` — every active capability's policy is a closed decision.
//
// Disabled / legacy product areas (Finances / Cash Flow, Customers surface)
// are NOT here — see catalog.ts.
export const CAPABILITY_REQUIREMENTS = Object.freeze({
    'overview.core': { moduleId: 'overview' },
    'overview.live_map': { moduleId: 'overview', minimumTier: 'growth' },
    'orders.core': { moduleId: 'order-nexus' },
    'inventory.core': { moduleId: 'products', minimumTier: 'core' },
    'demand.forecasting': { moduleId: 'demand', minimumTier: 'growth', feature: 'demand.forecasting' },
    'alerts.inbox': { moduleId: 'alerts' },
    'alerts.rules': { moduleId: 'alerts', minimumTier: 'growth', feature: 'alerts.rules' },
    // P0-A3-3: physical return receiving is warehouse EXECUTION, so it belongs to
    // the `wms` module Starter already holds — NOT to the Core+ `returns`
    // management module. Starter can receive a returned item on the floor without
    // gaining Returns Overview / Items / resolution.
    'returns.intake': { moduleId: 'wms', minimumTier: 'starter' },
    'returns.core': { moduleId: 'returns', minimumTier: 'core' },
    'returns.analysis': { moduleId: 'returns', minimumTier: 'growth', feature: 'returns.analysis' },
    'warehouse.operations': { moduleId: 'wms' },
    'warehouse.analytics': { moduleId: 'wms', minimumTier: 'growth', feature: 'wms.analytics' },
    'warehouse.floor_planning': { moduleId: 'floor-planning', minimumTier: 'growth' },
    'warehouse.problem_center': { moduleId: 'problem-center', minimumTier: 'core' },
    // COMMERCIAL-REMODEL-ALIGN-01: Purchasing is Core+, and ADVANCED SOURCING
    // (recommendations, worklist, supplier-product preference intelligence,
    // reorder/MOQ accumulation intelligence) is the Growth+ half of the split.
    'purchasing.core': { moduleId: 'suppliers-portal', minimumTier: 'core' },
    'purchasing.sourcing': { moduleId: 'suppliers-portal', minimumTier: 'growth' },
    'exports.core': { minimumTier: 'core' },
    'exports.column_selection': { minimumTier: 'growth', feature: 'exports.column_selection' },
    // specter.full_capture RETIRED by COMMERCIAL-REMODEL-ALIGN-01 — Specter is a
    // DEPRECATED product area (catalog.ts) and a deprecated area must not carry an
    // active paid capability. Its implementation is deliberately not deleted.
});
export const CAPABILITY_IDS = Object.freeze(Object.keys(CAPABILITY_REQUIREMENTS));
/** Alias — every canonical CapabilityId is currently active. */
export const ACTIVE_CAPABILITY_IDS = CAPABILITY_IDS;
export function isCapabilityId(value) {
    return typeof value === 'string' && value in CAPABILITY_REQUIREMENTS;
}
export function requirementForCapability(id) {
    return CAPABILITY_REQUIREMENTS[id];
}
