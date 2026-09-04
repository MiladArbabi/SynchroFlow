// apps/frontend/src/runtime/commercialContext.ts
//
// COMMERCIAL-ACCESS-ARCH-01 — Slice P0-A2B — frontend commercial-access adapter.
//
// The single frontend entry point onto the canonical @lasyncro/commercial-policy
// engine. Sidenav, ModuleTabBar, and CommercialGate all resolve their
// allow/deny decision through this file — never re-implement tier/module/
// feature logic locally.
//
// AccessContext = { tier, modules, flags } where modules/flags are the
// standard tier floor (modulesForTier/flagsForTier) UNION whatever the shop's
// live entitlement snapshot additionally grants. An unknown/unresolved
// CapabilityId always fails closed — never a Growth fallback.

import {
  evaluateAccess,
  modulesForTier,
  flagsForTier,
  isCapabilityId,
  CAPABILITY_REQUIREMENTS,
} from '@lasyncro/commercial-policy';
import type {
  AccessContext,
  AccessDecision,
  CapabilityId,
  Tier,
} from '@lasyncro/commercial-policy';
import { useEntitlements } from '../contexts/EntitlementsContext';

export interface CommercialSnapshot {
  modules: ReadonlySet<string>;
  flags: ReadonlySet<string>;
}

export interface BuildCommercialContextInput {
  tier: Tier;
  snapshot: CommercialSnapshot;
}

/** The standard tier floor UNION whatever the shop's live snapshot additionally grants. */
export function buildCommercialContext({ tier, snapshot }: BuildCommercialContextInput): AccessContext {
  const modules = new Set(modulesForTier(tier));
  for (const m of snapshot.modules) modules.add(m);

  const flags = new Set(flagsForTier(tier));
  for (const f of snapshot.flags) flags.add(f);

  return { tier, modules, flags };
}

/** Fail-closed decision for an unknown/unresolved capability id — never a Growth step. */
const CLOSED_UNKNOWN: AccessDecision = Object.freeze({
  allowed: false,
  reason: 'MODULE_NOT_INCLUDED',
});

/** Pure capability decision — the ONLY frontend entry point onto evaluateAccess(). */
export function decideCapability(capabilityId: string, context: AccessContext): AccessDecision {
  if (!isCapabilityId(capabilityId)) return CLOSED_UNKNOWN;
  return evaluateAccess(CAPABILITY_REQUIREMENTS[capabilityId], context);
}

export interface UseCommercialAccessResult {
  context: AccessContext;
  /** False while the live entitlement snapshot has not resolved yet — callers must not treat this as a denial. */
  isResolved: boolean;
  decide: (capabilityId: CapabilityId | string) => AccessDecision;
}

/** React entry point — wraps the live entitlement snapshot in the adapter above. */
export function useCommercialAccess(): UseCommercialAccessResult {
  const { tier, snapshot, hasResolved } = useEntitlements();
  const context = buildCommercialContext({ tier, snapshot });
  return {
    context,
    isResolved: hasResolved,
    decide: (capabilityId) => decideCapability(capabilityId, context),
  };
}
