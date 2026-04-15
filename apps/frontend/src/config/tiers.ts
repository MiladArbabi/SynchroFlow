// apps/frontend/src/config/tiers.ts
//
// Frontend-local tier constants — mirrors packages/backend-core/src/config/tiers.ts.
// CHANGE POLICY: Any change here must be reflected in backend-core/src/config/tiers.ts and vice versa.
// Source of truth for all frontend tier gating (MON-01, MON-06).

export const TIERS = ['starter', 'core', 'growth', 'scale'] as const;
export type Tier = (typeof TIERS)[number];

export function isValidTier(value: unknown): value is Tier {
  return TIERS.includes(value as Tier);
}

// --- Tier cap constants (frontend-local mirror of backend-core/config/tiers.ts) ---
// CHANGE POLICY: Must stay in sync with backend-core/src/config/tiers.ts.
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
  core: 2,
  growth: 5,
  scale: Infinity,
};