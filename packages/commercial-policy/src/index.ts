// @lasyncro/commercial-policy — the single, pure, isomorphic commercial-access
// spine shared by the frontend and the backend.
//
// P0-A1 implements the canonical policy engine:
//   - tier model (Tier, TIERS, TIER_ORDER, tierAtLeast)
//   - standard plan limits + pricing
//   - ModuleId registry + classification + modulesForTier()
//   - FeatureKey registry + flagsForTier()
//   - AccessRequirement / AccessContext / AccessDecision + evaluateAccess()
//   - canonical ACTIVE capability requirement registry + catalog
//
// backend-core consumes / re-exports this truth. commercial-policy must NEVER
// import backend-core (or React / Express / Knex / a DB client / env). It stays
// a zero-runtime-dependency leaf.
//
// P0-A2/A3 roll this into nav / tabs / routes / requireCapability. P0-A1 does
// NOT change any runtime surface or entitlement resolution.

// --- wiring sentinels (kept for the package-wiring contract) ---
export const COMMERCIAL_POLICY_PACKAGE = '@lasyncro/commercial-policy' as const;
export const COMMERCIAL_POLICY_WIRING_OK = true as const;

export {
  TIERS,
  TIER_ORDER,
  tierAtLeast,
  isValidTier,
} from './tiers.js';
export type { Tier } from './tiers.js';

export {
  PLAN_LIMITS,
  PLAN_PRICING_CENTS,
  PLAN_PROCESSED_ORDER_OVERAGE_CENTS,
  standardLimits,
} from './limits.js';
export type { PlanLimits } from './limits.js';

export {
  MODULE_IDS,
  MODULE_CLASSIFICATION,
  LEGACY_MODULES_BY_TIER,
  modulesForTier,
  isModuleId,
} from './modules.js';
export type { ModuleId, ModuleClassification } from './modules.js';

export {
  FEATURE_MIN_TIER,
  FEATURE_KEYS,
  featureMinTier,
  flagsForTier,
  isFeatureKey,
} from './features.js';
export type { FeatureKey } from './features.js';

export {
  evaluateAccess,
  standardContextForTier,
} from './access.js';
export type {
  AccessRequirement,
  AccessContext,
  AccessDecision,
  AccessReason,
} from './access.js';

export {
  CAPABILITY_REQUIREMENTS,
  CAPABILITY_IDS,
  ACTIVE_CAPABILITY_IDS,
  isCapabilityId,
  requirementForCapability,
} from './capabilities.js';
export type { CapabilityId } from './capabilities.js';

export {
  CAPABILITY_CATALOG,
  CATALOG,
  LEGACY_CAPABILITIES,
} from './catalog.js';
export type { CapabilityStatus, CatalogEntry } from './catalog.js';

// Frozen compatibility shape re-exported by @lasyncro/backend-core.
export {
  LEGACY_TIER_CONFIG,
  LEGACY_FLAGS_BY_TIER,
} from './legacy.js';
export type { LegacyTierConfig } from './legacy.js';
