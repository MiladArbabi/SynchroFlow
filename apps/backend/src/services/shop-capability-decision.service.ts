// apps/backend/src/services/shop-capability-decision.service.ts
//
// GH-1219 — shop-scoped commercial capability decision.
//
// The shopId-based equivalent of require-entitlement.middleware.ts's
// req.user-based resolveCapabilityDecision(), for execution contexts that
// have a verified shopId but no authenticated user (e.g. public WMS display
// tokens). Same pattern as stockProtectionReconciliation.worker.ts:
//
//   resolveEffectiveAccessForShop(shopId)
//     -> evaluateAccess(CAPABILITY_REQUIREMENTS[capabilityId], context)
//
// FAILURE SEMANTICS: an unrecognised tier value fails closed to 'starter'. A
// thrown resolver failure is not caught: current commercial truth is
// unavailable and must remain distinct from a legitimate Starter decision.

import { resolveEffectiveAccessForShop } from '@lasyncro/backend-core/services/effective-access.service.js';
import {
  CAPABILITY_REQUIREMENTS,
  evaluateAccess,
} from '@lasyncro/commercial-policy';
import type { AccessDecision, CapabilityId, Tier } from '@lasyncro/commercial-policy';

export async function resolveShopCapabilityDecision(
  shopId: number,
  capabilityId: CapabilityId,
): Promise<{ currentTier: Tier; decision: AccessDecision }> {
  const effective = await resolveEffectiveAccessForShop(shopId);
  const currentTier: Tier = effective.tier;
  const decision = evaluateAccess(
    CAPABILITY_REQUIREMENTS[capabilityId],
    effective.context,
  );
  return { currentTier, decision };
}
