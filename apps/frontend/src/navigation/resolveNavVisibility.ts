// apps/frontend/src/navigation/resolveNavVisibility.ts
//
// Nav visibility resolution (MON-06 frontend gating)
//
// Visibility states:
//   enabled   — user has access
//   locked    — user lacks access (show with upgrade prompt)
//   promoted  — locked but host wants to surface as upgrade CTA
//   hidden    — do not render
//
// Tier gating (A-11):
//   If a nav item requires a minimum tier and the user's tier is insufficient,
//   the item is 'locked' (or 'hidden' if hideIfLocked is set).
//   Tier hierarchy: starter < core < growth < scale

export type NavVisibility = 'hidden' | 'locked' | 'enabled' | 'promoted';

const TIER_ORDER: Record<string, number> = {
  starter: 0,
  core: 1,
  growth: 2,
  scale: 3,
};

interface ResolveNavVisibilityArgs {
  requiredModuleId?: string;
  modules: string[];
  /** Minimum subscription tier required to access this item (MON-06) */
  requiredTier?: string;
  /** Current user subscription tier */
  currentTier?: string;
  promoteIfLocked?: boolean;
  hideIfLocked?: boolean;
}

export function resolveNavVisibility({
  requiredModuleId,
  modules,
  requiredTier,
  currentTier = 'starter',
  promoteIfLocked,
  hideIfLocked,
}: ResolveNavVisibilityArgs): NavVisibility {
  // ISS-N1: DEV bypass previously skipped ALL gating (tier + module),
  // including the tier badge logic itself — meaning upgrade badges
  // (↑ Growth, ↑ Core) never rendered in local dev, making tier-gate
  // regressions like ISS-G1 invisible to normal browsing. Tier gating
  // now runs even in DEV; only the module-entitlement bypass remains,
  // since local dev seed data may legitimately lack certain module
  // grants unrelated to what's being tested.
  // --- Tier gate (checked first — tier supersedes module entitlement) ---
  if (requiredTier) {
    const required = TIER_ORDER[requiredTier] ?? 0;
    const current = TIER_ORDER[currentTier] ?? 0;

    if (current < required) {
      if (hideIfLocked) return 'hidden';
      if (promoteIfLocked) return 'promoted';
      return 'locked';
    }
  }

  // --- Module entitlement gate ---
  if (import.meta.env.DEV) return 'enabled';
  if (!requiredModuleId) return 'enabled';
  if (modules.includes(requiredModuleId)) return 'enabled';
  if (hideIfLocked) return 'hidden';
  if (promoteIfLocked) return 'promoted';
  return 'locked';
}