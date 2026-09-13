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
    'inventory.core': { moduleId: 'products' },
    'inventory.live_map': { moduleId: 'products', minimumTier: 'growth' },
    'alerts.inbox': { moduleId: 'alerts' },
    'orders.core': { moduleId: 'order-nexus', minimumTier: 'core' },
    'orders.live_map': { moduleId: 'order-nexus', minimumTier: 'growth' },
    'warehouse.operations': { moduleId: 'wms', minimumTier: 'core' },
    'returns.intake': { moduleId: 'returns', minimumTier: 'core' },
    'returns.core': { moduleId: 'returns', minimumTier: 'core' },
    'returns.analysis': { moduleId: 'returns', minimumTier: 'growth', feature: 'returns.analysis' },
    'warehouse.analytics': { moduleId: 'wms', minimumTier: 'core' },
    'exports.core': { minimumTier: 'core' },
    'demand.forecasting': { moduleId: 'demand', minimumTier: 'growth', feature: 'demand.forecasting' },
    'warehouse.floor_planning': { moduleId: 'floor-planning', minimumTier: 'growth' },
    'warehouse.problem_center': { moduleId: 'problem-center', minimumTier: 'growth' },
    'purchasing.core': { moduleId: 'suppliers-portal', minimumTier: 'growth' },
    'purchasing.sourcing': { moduleId: 'suppliers-portal', minimumTier: 'growth' },
    'alerts.rules': { moduleId: 'alerts', minimumTier: 'growth', feature: 'alerts.rules' },
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
