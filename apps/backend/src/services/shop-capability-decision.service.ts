// apps/backend/src/services/shop-capability-decision.service.ts
//
// GH-1219 — shop-scoped commercial capability decision.
//
// The shopId-based equivalent of require-entitlement.middleware.ts's
// req.user-based resolveCapabilityDecision(), for execution contexts that
// have a verified shopId but no authenticated user (e.g. public WMS display
// tokens). Same pattern as stockProtectionReconciliation.worker.ts:
//
//   resolveTierForShop(shopId) -> current authoritative tier
//     -> evaluateAccess(CAPABILITY_REQUIREMENTS[capabilityId],
//                       standardContextForTier(tier))
//
// STANDARD capability floor only — persisted shop_module_entitlements are
// deliberately not loaded, matching current backend requireCapability.
//
// FAILURE SEMANTICS: an unrecognised tier value fails closed to 'starter'
// (same as resolveTier(req)). A THROWN resolveTierForShop failure is NOT
// caught here — it means current commercial truth is unavailable, and the
// caller must distinguish that from a legitimate Starter subscription.

import { resolveTierForShop } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import {
  CAPABILITY_REQUIREMENTS,
  evaluateAccess,
  isValidTier,
  standardContextForTier,
} from '@lasyncro/commercial-policy';
import type { AccessDecision, CapabilityId, Tier } from '@lasyncro/commercial-policy';

export async function resolveShopCapabilityDecision(
  shopId: number,
  capabilityId: CapabilityId,
): Promise<{ currentTier: Tier; decision: AccessDecision }> {
  const rawTier = await resolveTierForShop(shopId);
  const currentTier: Tier = isValidTier(rawTier) ? rawTier : 'starter';
  const decision = evaluateAccess(
    CAPABILITY_REQUIREMENTS[capabilityId],
    standardContextForTier(currentTier),
  );
  return { currentTier, decision };
}
