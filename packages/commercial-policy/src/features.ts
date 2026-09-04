// @lasyncro/commercial-policy — canonical FeatureKey registry.
//
// Deliberately SMALL. The legacy frontend PLAN_FEATURES table (27 keys) is
// NOT copied — the audit found dead and contradictory entries there. Only the
// features that gate a currently-active capability are canonical here.
//
// Warehouse Analytics uses `wms.analytics` (Growth), never `wms.pick_batches`.

import type { Tier } from './tiers.js';
import { TIERS, tierAtLeast } from './tiers.js';

/** Canonical active feature flags → the minimum tier that includes them. */
export const FEATURE_MIN_TIER = Object.freeze({
  'wms.analytics':            'growth',
  'demand.forecasting':       'growth',
  'alerts.rules':             'growth',
  'returns.analysis':         'growth',
  'exports.column_selection': 'growth',
  'specter.full_capture':     'growth',
} as const satisfies Record<string, Tier>);

export type FeatureKey = keyof typeof FEATURE_MIN_TIER;

export const FEATURE_KEYS: readonly FeatureKey[] = Object.freeze(
  Object.keys(FEATURE_MIN_TIER) as FeatureKey[],
);

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && value in FEATURE_MIN_TIER;
}

/** Minimum tier a feature is included at (undefined if not a canonical feature). */
export function featureMinTier(key: string): Tier | undefined {
  return (FEATURE_MIN_TIER as Record<string, Tier>)[key];
}

/** The set of canonical feature flags a standard plan of `tier` includes. */
export function flagsForTier(tier: Tier): ReadonlySet<string> {
  const out = new Set<string>();
  for (const key of FEATURE_KEYS) {
    if (tierAtLeast(tier, FEATURE_MIN_TIER[key])) out.add(key);
  }
  return out;
}

void TIERS;
