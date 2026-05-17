// apps/backend/src/api/floor-planning/floor-planning.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import { 
  httpGetLayout, 
  httpUpdateProductBarcode, 
  httpGetGrid, 
  httpGetBinOccupancy
} from './floor-planning.controller.js';

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
  requireAction('floor-planning:read'),
  httpGetLayout
);

router.patch(
  '/products/:lasyncroVariantId/barcode',
  authenticateToken,
  requireFt2,
  requireAction('floor-planning:write'),
  httpUpdateProductBarcode
);

router.get(
  '/grid',
  authenticateToken,
  requireFt2,
  requireAction('floor-planning:read'),
  httpGetGrid
);

router.get(
  '/grid/occupancy',
  authenticateToken,
  requireFt2,
  requireAction('floor-planning:read'),
  httpGetBinOccupancy
);

export default router;