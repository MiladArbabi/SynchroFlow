// @lasyncro/commercial-policy — canonical ACTIVE capability registry.
//
// Exactly the ratified active capabilities (COMMERCIAL-ACCESS-ARCH-01 P0-A1).
// Each CapabilityId resolves to EXACTLY ONE non-contradictory AccessRequirement.
// No `openDecision` — every active capability's policy is a closed decision.
//
// Disabled / legacy product areas (Finances / Cash Flow, Customers surface)
// are NOT here — see catalog.ts.

import type { AccessRequirement } from './access.js';

export type CapabilityId =
  | 'overview.core'
  | 'overview.live_map'
  | 'orders.core'
  | 'inventory.core'
  | 'demand.forecasting'
  | 'alerts.inbox'
  | 'alerts.rules'
  | 'returns.core'
  | 'returns.analysis'
  | 'warehouse.operations'
  | 'warehouse.analytics'
  | 'warehouse.floor_planning'
  | 'warehouse.problem_center'
  | 'purchasing.core'
  | 'exports.core'
  | 'exports.column_selection'
  | 'specter.full_capture';

export const CAPABILITY_REQUIREMENTS: Readonly<Record<CapabilityId, AccessRequirement>> = Object.freeze({
  'overview.core':            { moduleId: 'overview' },
  'overview.live_map':        { moduleId: 'overview', minimumTier: 'growth' },
  'orders.core':              { moduleId: 'order-nexus' },
  'inventory.core':           { moduleId: 'products', minimumTier: 'core' },
  'demand.forecasting':       { moduleId: 'demand', minimumTier: 'growth', feature: 'demand.forecasting' },
  'alerts.inbox':             { moduleId: 'alerts' },
  'alerts.rules':             { moduleId: 'alerts', minimumTier: 'growth', feature: 'alerts.rules' },
  'returns.core':             { moduleId: 'returns', minimumTier: 'core' },
  'returns.analysis':         { moduleId: 'returns', minimumTier: 'growth', feature: 'returns.analysis' },
  'warehouse.operations':     { moduleId: 'wms' },
  'warehouse.analytics':      { moduleId: 'wms', minimumTier: 'growth', feature: 'wms.analytics' },
  'warehouse.floor_planning': { moduleId: 'floor-planning', minimumTier: 'growth' },
  'warehouse.problem_center': { moduleId: 'problem-center', minimumTier: 'core' },
  'purchasing.core':          { moduleId: 'suppliers-portal' },
  'exports.core':             { minimumTier: 'core' },
  'exports.column_selection':  { minimumTier: 'growth', feature: 'exports.column_selection' },
  'specter.full_capture':     { moduleId: 'specter', minimumTier: 'growth', feature: 'specter.full_capture' },
});

export const CAPABILITY_IDS: readonly CapabilityId[] = Object.freeze(
  Object.keys(CAPABILITY_REQUIREMENTS) as CapabilityId[],
);
/** Alias — every canonical CapabilityId is currently active. */
export const ACTIVE_CAPABILITY_IDS = CAPABILITY_IDS;

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === 'string' && value in CAPABILITY_REQUIREMENTS;
}

export function requirementForCapability(id: CapabilityId): AccessRequirement {
  return CAPABILITY_REQUIREMENTS[id];
}
