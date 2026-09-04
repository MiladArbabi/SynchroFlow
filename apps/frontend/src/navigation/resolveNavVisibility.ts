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
//   Tier hierarchy: starter < core < growth < scale — sourced from the
//   canonical @lasyncro/commercial-policy tierAtLeast(), never a private rank
//   map (COMMERCIAL-ACCESS-ARCH-01 P0-A2B / C8).
//
// Environment-independent (B5/C9): no build-mode/DEV-flag branch anywhere in
// this module — dev and production resolve the same decision from the same
// inputs. Commercial module/capability checks are never bypassed locally.
//
// CapabilityId items (P0-A2B): when a nav item carries a canonical
// CapabilityId, its allow/deny decision comes from the shared commercial
// adapter (runtime/commercialContext), never from requiredModuleId/requiredTier.

import { isValidTier, tierAtLeast } from '@lasyncro/commercial-policy';
import type { AccessDecision, CapabilityId } from '@lasyncro/commercial-policy';
import { decideCapability } from '../runtime/commercialContext';
import type { AccessContext } from '@lasyncro/commercial-policy';

export type NavVisibility = 'hidden' | 'locked' | 'enabled' | 'promoted';

interface ResolveNavVisibilityArgs {
  requiredModuleId?: string;
  modules: string[];
  /** Minimum subscription tier required to access this item (MON-06) */
  requiredTier?: string;
  /** Current user subscription tier */
  currentTier?: string;
  promoteIfLocked?: boolean;
  hideIfLocked?: boolean;
  /**
   * Canonical commercial capability (P0-A2B). When set, this item's decision
   * comes from the shared commercial adapter — requiredModuleId/requiredTier
   * are ignored. `context` must be supplied alongside it.
   */
  capabilityId?: CapabilityId;
  context?: AccessContext;
}

function visibilityFromDecision(
  decision: AccessDecision,
  { promoteIfLocked, hideIfLocked }: Pick<ResolveNavVisibilityArgs, 'promoteIfLocked' | 'hideIfLocked'>,
): NavVisibility {
  if (decision.allowed) return 'enabled';
  if (hideIfLocked) return 'hidden';
  if (promoteIfLocked) return 'promoted';
  return 'locked';
}

export function resolveNavVisibility({
  requiredModuleId,
  modules,
  requiredTier,
  currentTier = 'starter',
  promoteIfLocked,
  hideIfLocked,
  capabilityId,
  context,
}: ResolveNavVisibilityArgs): NavVisibility {
  // --- Canonical capability gate (P0-A2B migrated items) ---
  if (capabilityId && context) {
    const decision = decideCapability(capabilityId, context);
    return visibilityFromDecision(decision, { promoteIfLocked, hideIfLocked });
  }

  // --- Tier gate (checked first — tier supersedes module entitlement) ---
  if (requiredTier) {
    const required = isValidTier(requiredTier) ? requiredTier : 'starter';
    const current = isValidTier(currentTier) ? currentTier : 'starter';

    if (!tierAtLeast(current, required)) {
      if (hideIfLocked) return 'hidden';
      if (promoteIfLocked) return 'promoted';
      return 'locked';
    }
  }

  // --- Module entitlement gate ---
  if (!requiredModuleId) return 'enabled';
  if (modules.includes(requiredModuleId)) return 'enabled';
  if (hideIfLocked) return 'hidden';
  if (promoteIfLocked) return 'promoted';
  return 'locked';
}