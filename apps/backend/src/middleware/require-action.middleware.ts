// apps/backend/src/middleware/require-action.middleware.ts
//
// ACTION-LEVEL ENTITLEMENTS (WM-19)
// -----------------------------------
// Replaces requireRole([...]) across all routes.
//
// Routes declare WHAT they do (action), not WHO can do it (role).
// The canonical role→action map lives in
// services/permissions/permissionPolicy.ts. This middleware consumes
// that policy; locked permissions cannot be overridden per shop.
//
// Usage:
//   router.post('/batch/release', authenticateToken, requireFt2, requireAction('wms:batch:release'), handler)
//   router.get('/suppliers',      authenticateToken, requireFt2, requireAction('suppliers:read'), handler)
//
// Action taxonomy:
//   <domain>:<resource>:<verb>   e.g. wms:batch:release
//   <domain>:<verb>              e.g. suppliers:read
//
// Roles (unchanged — sourced from shop_memberships.role via JWT shop_roles claim):
//   owner    — full access
//   admin    — same as owner
//   operator — warehouse floor only
//
// CHANGE POLICY:
//   To change action-role defaults, edit ACTION_ROLE_MAP in
//   services/permissions/permissionPolicy.ts.
//   Never add role arrays to route files.
//   Never add new roles without updating the canonical map.

import type { Request, Response, NextFunction } from 'express';
import '@lasyncro/backend-core/middleware/auth.middleware.js'; // augments Express.Request with .user
import { isActionAllowed } from '../services/permissions/permissionCache.service.js';
import { ACTION_ROLE_MAP } from '../services/permissions/permissionPolicy.js';
export { ACTION_ROLE_MAP };



/**
 * Middleware: require a specific action entitlement.
 *
 * Reads roles from req.user.roles (set by authenticateToken from JWT shop_roles claim).
 * Fails closed: missing roles = 401, insufficient role = 403.
 *
 * @param action - Key from ACTION_ROLE_MAP
 */
export function requireAction(action: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Guard: unknown action = misconfigured route, not a user error
    if (!ACTION_ROLE_MAP[action]) {
      console.error('[requireAction] Unknown action:', action);
      return res.status(500).json({ error: 'MISCONFIGURED_ACTION', action });
    }

    const roles = req.user?.roles;
    const shopId = req.user?.shopId;

    if (!roles) {
      return res.status(401).json({
        error: 'MISSING_ROLES_CLAIM',
        action: 'LOGOUT_REQUIRED',
      });
    }

    if (roles.length === 0) {
      return res.status(403).json({
        error: 'NO_ROLE_ASSIGNED',
        action: 'CONTACT_ADMIN',
      });
    }

    // Locked actions follow canonical roles. Configurable actions use
    // Redis/DB-backed grants with canonical defaults where absent.
    if (shopId) {
      let allowed = false;
      for (const role of roles) {
        if (await isActionAllowed(shopId, action, role)) {
          allowed = true;
          break;
        }
      }
      return allowed
        ? next()
        : res.status(403).json({ error: 'ACTION_FORBIDDEN', action, current: roles });
    }

    // Fallback: no shopId on token — use static ACTION_ROLE_MAP
    const allowedRoles = ACTION_ROLE_MAP[action] as string[];
    const hasRole = roles.some((r: string) => allowedRoles.includes(r));
    if (!hasRole) {
      return res.status(403).json({
        error: 'ACTION_FORBIDDEN',
        action,
        current: roles,
      });
    }

    return next();
  };
}
