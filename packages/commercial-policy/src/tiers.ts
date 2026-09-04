// @lasyncro/commercial-policy — canonical tier model.
//
// This is THE single physical source of tier identity + rank for the whole
// product (frontend nav/tabs/routes, backend enforcement, billing). Every
// other tier-rank map in the codebase must become a re-export of this.
//
// Pure: no runtime deps, no env, no DB, no framework.

export const TIERS = ['starter', 'core', 'growth', 'scale'] as const;
export type Tier = (typeof TIERS)[number];

/** Canonical monotonic rank. starter < core < growth < scale. */
export const TIER_ORDER: Readonly<Record<Tier, number>> = Object.freeze({
  starter: 0,
  core: 1,
  growth: 2,
  scale: 3,
});

/** True when `actual` tier meets or exceeds `required`. Higher always wins. */
export function tierAtLeast(actual: Tier, required: Tier): boolean {
  return TIER_ORDER[actual] >= TIER_ORDER[required];
}

/** Narrowing guard — unknown strings are rejected (callers fail closed). */
export function isValidTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}
