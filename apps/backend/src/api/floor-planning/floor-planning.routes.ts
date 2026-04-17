// apps/backend/src/api/floor-planning/floor-planning.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireRole } from '../../middleware/require-role.middleware.js';
import { httpGetLayout, httpUpdateProductBarcode } from './floor-planning.controller.js';

/**
 * FLOOR PLANNING ROUTES
 * ----------------------
 * All routes require FT2 lifecycle and owner/admin role.
 * Operators do not manage floor layout.
 *
 * FEAT-002: Extend with POST /zones, PATCH /zones/:code/barcode, etc.
 * once barcode column is added to warehouse_locations.
 */
const router = Router();

router.get(
  '/layout',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpGetLayout
);

router.patch(
  '/products/:lasyncroVariantId/barcode',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpUpdateProductBarcode
);

export default router;