// apps/frontend/src/config/tiers.ts
//
// Frontend-local tier type + UI cap constants.
//
// SCOPE: UI-only — types, tier ordering, and display thresholds.
// ENFORCEMENT (module grants, flag lists, pricing) lives exclusively
// in packages/backend-core/src/config/tiers.ts — do NOT duplicate here.
//
// CHANGE POLICY:
//   - Adding a new tier → update TIERS + all three cap records here AND backend-core.
//   - Changing a cap value → update here AND backend-core/config/tiers.ts TierConfig.
//   - Module grants / flags → backend-core ONLY. Never add those here.

export const TIERS = ['starter', 'core', 'growth', 'scale'] as const;
export type Tier = (typeof TIERS)[number];

export function isValidTier(value: unknown): value is Tier {
  return TIERS.includes(value as Tier);
}

// --- UI display thresholds (mirrors TierConfig values in backend-core) ---
// Used for upgrade prompts and usage indicators only. Never for enforcement.
// Used for upgrade prompt thresholds and usage indicator UI only.
// Never use for enforcement — enforcement is backend-only.
export const TIER_MONTHLY_ORDER_CAP: Record<Tier, number> = {
  starter: 50,
  core: 2000,
  growth: 10000,
  scale: Infinity,
};

export const TIER_SHIPPED_ORDER_CAP: Record<Tier, number> = {
  starter: 0,
  core: 200,
  growth: 1000,
  scale: Infinity,
};

export const TIER_SEAT_LIMIT: Record<Tier, number> = {
  starter: 1,
  core: 3,
  growth: 5,
  scale: Infinity,
};