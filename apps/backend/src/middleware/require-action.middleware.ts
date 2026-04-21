// apps/backend/src/middleware/require-action.middleware.ts
//
// ACTION-LEVEL ENTITLEMENTS (WM-19)
// -----------------------------------
// Replaces requireRole([...]) across all routes.
//
// Routes declare WHAT they do (action), not WHO can do it (role).
// The role→action map here is the single source of truth for
// permission policy. Changing who can do something = one line change here.
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
//   To change who can perform an action: edit ACTION_ROLE_MAP only.
//   Never add role arrays to route files.
//   Never add new roles without updating this map.

import type { Request, Response, NextFunction } from 'express';
import '@lasyncro/backend-core/middleware/auth.middleware.js'; // augments Express.Request with .user
import { isActionAllowed } from '../services/permissions/permissionCache.service.js';

/**
 * Canonical action → allowed roles map.
 *
 * Actions are grouped by domain for readability.
 * Every requireRole([...]) in the codebase maps to exactly one action here.
 */
export const ACTION_ROLE_MAP: Record<string, string[]> = {

  // ── SUPPLIERS / PO ─────────────────────────────────────────
  'suppliers:read':           ['owner', 'admin'],
  'suppliers:write':          ['owner', 'admin'],
  'po:read':                  ['owner', 'admin'],
  'po:write':                 ['owner', 'admin'],
  'po:receive':               ['owner', 'admin'],
  'po:status':                ['owner', 'admin'],
  'receive-job:create':       ['owner', 'admin', 'operator'],
  'receive-job:read':         ['owner', 'admin', 'operator'],
  'receive-job:inspect':      ['owner', 'admin', 'operator'],
  'receive-job:close':        ['owner', 'admin'],
  'receive-job:exception':    ['owner', 'admin', 'operator'],

  // ── WMS ────────────────────────────────────────────────────
  'wms:read':                 ['owner', 'admin', 'operator'],
  'wms:batch:release':        ['owner', 'admin'],
  'wms:batch:claim':          ['owner', 'admin', 'operator'],
  'wms:pick:scan':            ['owner', 'admin', 'operator'],
  'wms:pack:scan':            ['owner', 'admin', 'operator'],
  'wms:stow:claim':           ['owner', 'admin', 'operator'],
  'wms:stow:confirm':         ['owner', 'admin', 'operator'],
  'wms:stow:location':        ['owner', 'admin'],
  'wms:exception:report':     ['owner', 'admin', 'operator'],
  'wms:ship:confirm':         ['owner', 'admin'],
  'wms:settings:write':       ['owner', 'admin'],

  // ── FLOOR PLANNING ─────────────────────────────────────────
  'floor-planning:read':      ['owner', 'admin'],
  'floor-planning:write':     ['owner', 'admin'],

  // ── CUSTOMERS ──────────────────────────────────────────────────────────────
  'customers:read':           ['owner', 'admin'],

  // ── OVERVIEW / MORNING BRIEF ───────────────────────────────
  'overview:read':            ['owner', 'admin'],
  'morning-brief:read':       ['owner', 'admin'],

  // ── MEMBERS ────────────────────────────────────────────────
  'members:read':             ['owner', 'admin'],
  'members:write':            ['owner'],           // owner-only: role assignment
  'members:remove':           ['owner'],           // owner-only: seat removal

  // ── BILLING ────────────────────────────────────────────────
  'billing:read':             ['owner', 'admin'],
  'billing:write':            ['owner'],           // owner-only: plan changes

  // ── SHOPIFY BILLING ────────────────────────────────────────
  'shopify-billing:read':     ['owner', 'admin'],
  'shopify-billing:write':    ['owner'],
};

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

    // Shop-configured permissions (Redis-cached, DB-backed).
    // Falls back to ACTION_ROLE_MAP if shop has no config yet.
    // Shop-configured permissions (Redis-cached, DB-backed).
    // Falls back to ACTION_ROLE_MAP if shop has no config yet.
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