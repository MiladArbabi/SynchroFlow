// apps/backend/src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/**
 * Canonical Auth Context extracted from JWT.
 * This is the ONLY trusted identity surface for downstream services.
 */
export interface AuthContext {
  userId: number;              // REQUIRED — hard invariant
  shopId?: number;             // Optional (future-safe)
  actorType?: 'shop_user' | 'system_service' | 'support_admin';
  roles?: string[];
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

  jwt.verify(token, jwtSecret, (err: any, user: any) => {
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

    // ✅ Canonical auth context
    req.user = {
      userId: payload.user_id,
      shopId: payload.shop_id,
      actorType: payload.actor_type,
      roles: payload.shop_roles,
    };

    return next();
  });
};