// apps/backend/src/api/settings/permissions.controller.ts
//
// PERMISSION SETTINGS CONTROLLER (WM-19 v2)
// -------------------------------------------
// GET  /api/v1/settings/permissions  — returns full permission matrix for shop
// PATCH /api/v1/settings/permissions — update one or more action/role permissions
//
// Owner only — enforced via requireAction('wms:settings:write') on routes.

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