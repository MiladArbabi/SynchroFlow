// apps/backend/src/api/settings/permissions.controller.ts
//
// PERMISSION SETTINGS CONTROLLER (WM-19 v2)
// -------------------------------------------
// GET  /api/v1/settings/permissions  — returns full permission matrix for shop
// PATCH /api/v1/settings/permissions — update one or more action/role permissions
//
// Authorization:
//   GET   — owner/admin via route-level requireAction('wms:settings:write').
//   PATCH — the same route-level admission (owner/admin) PLUS an independent,
//           non-configurable owner-only guard in httpUpdatePermissions.
//
// AUTH-PERM-01 (D06): requireAction resolves through the shop-configurable
// permission map (isActionAllowed / shop_role_permissions), and admin holds
// 'wms:settings:write'. The owner-only guard reads the trusted JWT shop_roles
// claim directly so no persisted grant can widen who may change the matrix
// (RECOUNT-131 precedent, inventoryRecount.controller.ts).

import { Request, Response } from 'express';
import {
  getPermissionMatrix,
  updatePermissions,
  PermissionUpdate,
  ROLES,
} from '../../services/permissions/permissionSettings.service.js';

export async function httpGetPermissions(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const matrix = await getPermissionMatrix(shopId);
    return res.json(matrix);
  } catch (err) {
    console.error('[permissions] httpGetPermissions failed', err);
    return res.status(500).json({ error: 'Failed to load permissions' });
  }
}

export async function httpUpdatePermissions(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  // AUTH-PERM-01: owner-only, independent of shop permission config. Runs
  // before body validation, persistence and cache invalidation.
  const roles: string[] = req.user?.roles ?? [];
  if (!roles.includes('owner')) {
    return res.status(403).json({ error: 'ACTION_FORBIDDEN', requiredRole: 'owner' });
  }

  const { updates } = req.body;

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'updates must be a non-empty array' });
  }

  // Validate shape of each update
  for (const u of updates) {
    if (!u.action || !u.role || typeof u.granted !== 'boolean') {
      return res.status(400).json({
        error: 'Each update requires action (string), role (string), granted (boolean)',
      });
    }
    if (!ROLES.includes(u.role)) {
      return res.status(400).json({ error: `Invalid role: ${u.role}. Must be one of: ${ROLES.join(', ')}` });
    }
  }

  try {
    const result = await updatePermissions(shopId, updates as PermissionUpdate[]);
    return res.json(result);
  } catch (err) {
    console.error('[permissions] httpUpdatePermissions failed', err);
    return res.status(500).json({ error: 'Failed to update permissions' });
  }
}