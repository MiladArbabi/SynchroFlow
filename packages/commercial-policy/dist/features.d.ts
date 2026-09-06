import type { Tier } from './tiers.js';
/** Canonical active feature flags → the minimum tier that includes them. */
export declare const FEATURE_MIN_TIER: Readonly<{
    readonly 'wms.analytics': "growth";
    readonly 'demand.forecasting': "growth";
    readonly 'alerts.rules': "growth";
    readonly 'returns.analysis': "growth";
    readonly 'exports.column_selection': "growth";
}>;
export type FeatureKey = keyof typeof FEATURE_MIN_TIER;
export declare const FEATURE_KEYS: readonly FeatureKey[];
export declare function isFeatureKey(value: unknown): value is FeatureKey;
/** Minimum tier a feature is included at (undefined if not a canonical feature). */
export declare function featureMinTier(key: string): Tier | undefined;
/** The set of canonical feature flags a standard plan of `tier` includes. */
export declare function flagsForTier(tier: Tier): ReadonlySet<string>;
