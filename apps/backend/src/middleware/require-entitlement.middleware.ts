// apps/backend/src/middleware/require-entitlement.middleware.ts
//
// Entitlement Middleware (MON-03)
// --------------------------------
// Replaces requireRole for module-level access control.
//
// Gates access by subscription tier. GH-1136: authenticateToken has already
// resolved this to the CURRENT authoritative shop_subscriptions tier before
// this middleware runs — req.user.tier is no longer the JWT's issuance-time
// claim verbatim (see packages/backend-core/src/middleware/auth.middleware.ts).
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
import type { AccessDecision, CapabilityId } from '@lasyncro/commercial-policy';
import { captureEvent } from '../utils/analytics.js';

/**
 * Middleware: require a minimum subscription tier.
 *
 * Reads tier from req.user.tier — set by authenticateToken from the CURRENT
 * authoritative shop_subscriptions tier (GH-1136), not the JWT claim verbatim.
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
 * COMMERCIAL-ACCESS-ARCH-01 P0-A2A — capability-level commercial decision.
 *
 * Resolves the acting request's tier via `resolveTier(req)` and evaluates the
 * canonical `CAPABILITY_REQUIREMENTS[capabilityId]` from
 * @lasyncro/commercial-policy against a STANDARD context for that tier
 * (`modulesForTier` / `flagsForTier`).
 *
 * TRANSITIONAL BOUNDARY (P0-A2A/A3-1): standard-plan capabilities only.
 * Persisted `shop_module_entitlements` rows are deliberately NOT loaded here
 * — every migrated capability so far is a standard-plan capability. Bespoke
 * row-based backend capability grants land in P0-A3.
 *
 * TIER FRESHNESS (GH-1136, formerly P0-B): this function itself makes no DB
 * round-trip — it still follows `req.user.tier` verbatim, unchanged. What
 * changed is where that value comes from: authenticateToken now re-resolves
 * it from the CURRENT authoritative shop_subscriptions row on every request
 * (packages/backend-core/src/middleware/auth.middleware.ts), rather than
 * trusting the JWT's issuance-time tier claim. A shop downgraded mid-session
 * therefore loses paid access on its very next request, not only after its
 * access token expires.
 *
 * This is the ONE shared primitive both route-level `requireCapability` and
 * field-level controller checks (e.g. exports' filters.columns ->
 * exports.column_selection) build on — never re-evaluate
 * CAPABILITY_REQUIREMENTS/evaluateAccess independently.
 */
function resolveCapabilityDecision(
  req: Request,
  capabilityId: CapabilityId,
): { decision: AccessDecision; currentTier: Tier } {
  const currentTier = resolveTier(req);
  const decision = evaluateAccess(CAPABILITY_REQUIREMENTS[capabilityId], {
    tier: currentTier,
    modules: modulesForTier(currentTier),
    flags: flagsForTier(currentTier),
  });
  return { decision, currentTier };
}

/**
 * Shared denial path: the SAME normalized COMMERCIAL_ACCESS_DENIED body and
 * the SAME paywall_hit analytics semantics for every commercial-capability
 * denial, whether raised by route-level `requireCapability` or a field-level
 * controller check. Sends the 403 response — callers must not write their
 * own response after calling this.
 */
function sendCapabilityDenied(
  req: Request,
  res: Response,
  capabilityId: CapabilityId,
  decision: AccessDecision,
  currentTier: Tier,
): void {
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

  res.status(403).json(body);
}

/**
 * Route-level middleware: require a canonical capability. See
 * resolveCapabilityDecision/sendCapabilityDenied above for the shared
 * decision + denial-response primitives. Role/permission denial stays owned
 * by requireAction and is never produced here.
 */
export function requireCapability(capabilityId: CapabilityId) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { decision, currentTier } = resolveCapabilityDecision(req, capabilityId);

    if (decision.allowed) {
      return next();
    }

    return sendCapabilityDenied(req, res, capabilityId, decision, currentTier);
  };
}

/**
 * Field-level capability enforcement for use INSIDE a controller (e.g. a
 * request-body flag like exports' `filters.columns` that gates a narrower
 * capability than the route's own gate). Consumes the SAME
 * resolveCapabilityDecision/sendCapabilityDenied primitives requireCapability
 * uses — no independent tier/module/feature evaluation.
 *
 * Returns true and does nothing further when allowed (caller proceeds).
 * Returns false when denied — the 403 COMMERCIAL_ACCESS_DENIED response has
 * already been sent; the caller must return immediately without writing its
 * own response.
 */
export function enforceCapability(req: Request, res: Response, capabilityId: CapabilityId): boolean {
  const { decision, currentTier } = resolveCapabilityDecision(req, capabilityId);

  if (decision.allowed) {
    return true;
  }

  sendCapabilityDenied(req, res, capabilityId, decision, currentTier);
  return false;
}