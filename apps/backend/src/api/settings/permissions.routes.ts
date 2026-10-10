// apps/backend/src/api/settings/permissions.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import { httpGetPermissions, httpUpdatePermissions } from './permissions.controller.js';

const router = Router();

/**
 * GET /api/v1/settings/permissions
 * Returns full permission matrix for the shop.
 * Owner/admin can view — admitted by requireAction('wms:settings:write').
 */
router.get(
  '/',
  authenticateToken,
  requireAction('wms:settings:write'),
  httpGetPermissions
);

/**
 * PATCH /api/v1/settings/permissions
 * Update one or more action/role permission grants.
 * Owner only. requireAction('wms:settings:write') admits owner/admin; the
 * controller then applies an independent, non-configurable owner-only guard
 * on the JWT roles (AUTH-PERM-01).
 */
router.patch(
  '/',
  authenticateToken,
  requireAction('wms:settings:write'),
  httpUpdatePermissions
);

export default router;