// apps/backend/src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { runWithTenantContext } from '../tenant-context.js';
import { resolveTierForShop } from '../services/shop-resolution.service.js';

/**
 * Canonical Auth Context extracted from JWT + resolved at request time.
 * This is the ONLY trusted identity surface for downstream services.
 */
export interface AuthContext {
  userId: number;              // REQUIRED — hard invariant
  shopId?: number;             // Optional (future-safe)
  actorType?: 'shop_user' | 'system_service' | 'support_admin';
  roles?: string[];
  /**
   * GH-1136 — CURRENT authoritative subscription tier, re-resolved from
   * shop_subscriptions on every authenticated request via
   * resolveTierForShop(shopId). The JWT's own `tier` claim is issuance-time
   * only (a session hint token.service.ts stamps at login) and is
   * deliberately NOT trusted here — a shop downgraded mid-session must lose
   * paid access before its access token expires, not after.
   */
  tier?: string;
}

// Extend the Express Request type to include the user property
declare global {
  namespace Express {
    interface Request {
      user?: AuthContext;
    }
  }
}

export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (token == null) {
    // No token at all → hard unauthenticated
    return res.status(401).json({ error: 'Unauthorized: No token provided.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('JWT_SECRET is not set!');
    return res.status(500).json({ error: 'Internal server error: JWT secret missing.' });
  }

  jwt.verify(token, jwtSecret, async (err: any, user: any) => {
    if (err) {
      // 🔒 Token is structurally invalid (tampered / wrong secret)
      if (err.name !== 'TokenExpiredError') {
        console.error('[auth] Invalid JWT:', err.message);
        return res.status(403).json({ error: 'Forbidden: Invalid token.' });
      }

      // 🟡 Token expired
      console.warn('[auth] JWT expired');
      return res.status(401).json({
        error: 'TOKEN_EXPIRED',
        refreshable: true
      });
    }

    const payload = user as any;

   // 🔒 Hard invariant: user_id must exist and be a number (JWT contract uses snake_case)
    if (!payload || typeof payload.user_id !== 'number') {
      console.error('[auth] Invalid token payload shape', payload);
      return res.status(401).json({
        error: 'INVALID_TOKEN_PAYLOAD',
        action: 'LOGOUT_REQUIRED',
      });
    }

    // ✅ Identity + tenant invariants preserved from the JWT exactly as before.
    const shopId = payload.shop_id;

    if (!Number.isInteger(shopId) || Number(shopId) <= 0) {
      return res.status(401).json({
        error: 'INVALID_TOKEN_TENANT',
        action: 'LOGOUT_REQUIRED',
      });
    }

    // GH-1136 — resolve CURRENT authoritative tier from shop_subscriptions
    // rather than trusting the JWT's issuance-time tier claim. This is the
    // one place request-time commercial authority is established; downstream
    // middleware (requireTier/requireCapability/meetsTier) keeps reading
    // req.user.tier unchanged, it just now reads a freshly resolved value.
    //
    // FAIL-CLOSED: a resolution failure must never fall back to the JWT's
    // paid tier claim — that would silently readmit exactly the stale-access
    // window this change exists to close. Return 503 and let the client retry
    // rather than authorize on unverifiable commercial state.
    let currentTier: string;
    try {
      currentTier = await resolveTierForShop(Number(shopId));
    } catch (resolutionError) {
      console.error('[auth] Failed to resolve authoritative tier for shop', {
        shopId,
        error: resolutionError instanceof Error ? resolutionError.message : resolutionError,
      });
      return res.status(503).json({
        error: 'COMMERCIAL_STATE_UNAVAILABLE',
        retryable: true,
      });
    }

    // ✅ Canonical auth context
    req.user = {
      userId: payload.user_id,
      shopId,
      actorType: payload.actor_type,
      roles: payload.shop_roles,
      tier: currentTier,
    };

    return runWithTenantContext(Number(req.user.shopId), next);
  });
};
