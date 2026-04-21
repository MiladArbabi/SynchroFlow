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
//   Tier order is defined here as TIER_ORDER.
//   Never hardcode tier strings in route files.

import { Request, Response, NextFunction } from 'express';
import { Tier, TIERS } from '@lasyncro/backend-core/config/tiers.js';

/**
 * Tier hierarchy index — higher index = higher tier.
 * Must stay in sync with TIERS order in tiers.ts.
 */
const TIER_ORDER: Record<Tier, number> = {
  starter: 0,
  core: 1,
  growth: 2,
  scale: 3,
};

/**
 * Middleware: require a minimum subscription tier.
 *
 * Reads tier from req.user.tier (set by authenticateToken from JWT claim).
 * Fails closed: missing or unrecognized tier is treated as 'starter'.
 */
export function requireTier(minimumTier: Tier) {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawTier = req.user?.tier ?? 'starter';
    const currentTier = TIERS.includes(rawTier as Tier) ? (rawTier as Tier) : 'starter';

    if (TIER_ORDER[currentTier] < TIER_ORDER[minimumTier]) {
      return res.status(403).json({
        error: 'TIER_INSUFFICIENT',
        required: minimumTier,
        current: currentTier,
      });
    }

    return next();
  };
}