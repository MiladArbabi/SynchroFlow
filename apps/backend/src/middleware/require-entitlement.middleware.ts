// apps/backend/src/middleware/require-entitlement.middleware.ts
//
// Entitlement Middleware (MON-03)
// --------------------------------
// Replaces requireRole for module-level access control.
//
// Gates access by subscription tier (from JWT claim).
// Does NOT replace role checks for permission levels (owner/admin/operator) —
// role checks are handled by requireAction middleware (WM-19).
//
// Usage:
//   router.get('/cash-flow', authenticateToken, requireTier('growth'), handler)
//   router.post('/batch/release', authenticateToken, requireTier('core'), requireRole(['owner','admin']), handler)
//
// Tier hierarchy (cumulative):
//   starter < core < growth < scale
//
// CHANGE POLICY:
//   Tier rank comparison is delegated to `tierAtLeast()` from
//   @lasyncro/commercial-policy — the single physical source of tier order.
//   Never hardcode tier strings in route files, and never reintroduce a local
//   tier-rank map here (COMMERCIAL-ACCESS-ARCH-01 P0-A2A).

import { Request, Response, NextFunction } from 'express';
import { Tier, TIERS } from '@lasyncro/backend-core/config/tiers.js';
import {
  tierAtLeast,
  evaluateAccess,
  CAPABILITY_REQUIREMENTS,
  modulesForTier,
  flagsForTier,
} from '@lasyncro/commercial-policy';
import type { CapabilityId } from '@lasyncro/commercial-policy';
import { captureEvent } from '../utils/analytics.js';

/**
 * Middleware: require a minimum subscription tier.
 *
 * Reads tier from req.user.tier (set by authenticateToken from JWT claim).
 * Fails closed: missing or unrecognized tier is treated as 'starter'.
 */
/**
 * Resolve the request's effective tier. Fails closed: missing or
 * unrecognized tier is treated as 'starter'.
 */
export function resolveTier(req: Request): Tier {
  const rawTier = req.user?.tier ?? 'starter';
  return TIERS.includes(rawTier as Tier) ? (rawTier as Tier) : 'starter';
}

/**
 * FP-GATE1: boolean tier check for field-level guards inside controllers.
 *
 * Route-level gating can't express "this endpoint is Starter, but these
 * fields within its payload are Growth". Floor-planning zone create/update
 * accept spatial geometry (Canvas) and non-spatial attributes (List) in the
 * same payload, so the Growth gate has to live in the handler. This helper
 * exists so those handlers reuse the canonical comparator rather than
 * reimplementing the hierarchy — see CHANGE POLICY above.
 */
export function meetsTier(req: Request, minimumTier: Tier): boolean {
  return tierAtLeast(resolveTier(req), minimumTier);
}

export function requireTier(minimumTier: Tier) {
  return (req: Request, res: Response, next: NextFunction) => {
    const currentTier = resolveTier(req);

    if (!tierAtLeast(currentTier, minimumTier)) {
      /**
       * PH-03: paywall_hit — fires every time a shop hits a tier gate.
       * This is the most valuable monetization signal — tells us exactly
       * which features merchants want but can't access on their current tier.
       * High paywall_hit count on a feature = strong upgrade motivation.
       * Fire-and-forget — never delay the 403 response.
       */
      const shopId = req.user?.shopId;
      if (shopId) {
        captureEvent({
          shopId,
          event: 'paywall_hit',
          properties: {
            required_tier: minimumTier,
            current_tier: currentTier,
            path: req.path,
            method: req.method,
          },
        });
      }

      return res.status(403).json({
        error: 'TIER_INSUFFICIENT',
        required: minimumTier,
        current: currentTier,
      });
    }

    return next();
  };
}

/**
 * COMMERCIAL-ACCESS-ARCH-01 P0-A2A — capability-level commercial gate.
 *
 * Resolves the acting request's tier from the JWT claim (`resolveTier(req)` —
 * no DB round-trip) and evaluates the canonical
 * `CAPABILITY_REQUIREMENTS[capabilityId]` from @lasyncro/commercial-policy
 * against a STANDARD context for that tier (`modulesForTier` / `flagsForTier`).
 *
 * TRANSITIONAL BOUNDARY (P0-A2A): standard-plan capabilities only. Persisted
 * `shop_module_entitlements` rows are deliberately NOT loaded here — every
 * A2A-migrated capability is a standard-plan capability. Bespoke row-based
 * backend capability grants land in P0-A3.
 *
 * JWT TIER BOUNDARY: the decision follows `req.user.tier` verbatim. No
 * subscription-table round-trip — this preserves the current <= access-token
 * lifetime staleness profile. Commercial-state freshness is P0-B.
 *
 * On denial: HTTP 403 with a normalized COMMERCIAL_ACCESS_DENIED body
 * `{ error, reason, capabilityId, currentTier, requiredTier?, requiredModule?,
 * requiredFeature? }`. Commercial reasons only (TIER_TOO_LOW /
 * MODULE_NOT_INCLUDED / FEATURE_NOT_INCLUDED). Role/permission denial stays
 * owned by requireAction and is never produced here.
 */
export function requireCapability(capabilityId: CapabilityId) {
  return (req: Request, res: Response, next: NextFunction) => {
    const currentTier = resolveTier(req);
    const decision = evaluateAccess(CAPABILITY_REQUIREMENTS[capabilityId], {
      tier: currentTier,
      modules: modulesForTier(currentTier),
      flags: flagsForTier(currentTier),
    });

    if (decision.allowed) {
      return next();
    }

    // PH-03: paywall_hit — same monetization signal requireTier emits, keyed
    // by capability. Fire-and-forget; never delay the 403.
    const shopId = req.user?.shopId;
    if (shopId) {
      captureEvent({
        shopId,
        event: 'paywall_hit',
        properties: {
          capability_id: capabilityId,
          reason: decision.reason,
          required_tier: decision.requiredTier ?? null,
          current_tier: currentTier,
          path: req.path,
          method: req.method,
        },
      });
    }

    const body: {
      error: 'COMMERCIAL_ACCESS_DENIED';
      reason: string;
      capabilityId: string;
      currentTier: Tier;
      requiredTier?: string;
      requiredModule?: string;
      requiredFeature?: string;
    } = {
      error: 'COMMERCIAL_ACCESS_DENIED',
      reason: decision.reason,
      capabilityId,
      currentTier,
    };
    if (decision.requiredTier) body.requiredTier = decision.requiredTier;
    if (decision.requiredModule) body.requiredModule = decision.requiredModule;
    if (decision.requiredFeature) body.requiredFeature = decision.requiredFeature;

    return res.status(403).json(body);
  };
}