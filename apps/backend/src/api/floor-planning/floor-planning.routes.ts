// apps/backend/src/api/floor-planning/floor-planning.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import { 
  httpGetLayout, 
  httpUpdateProductBarcode, 
  httpGetGrid, 
  httpGetBinOccupancy,
  httpGetBinLog,
  httpGetBinStats,
  httpGetVariantBins,
  httpCreateZone,
  httpDeleteZone,
  httpUpdateZone,
  httpPrintBarcode
} from './floor-planning.controller.js';

/**
 * FLOOR PLANNING ROUTES
 * ----------------------
 * All routes require FT2 lifecycle, Scale-tier subscription, and owner/admin role.
 * Operators do not manage floor layout.
 *
 * SECURITY FIX (audit ISS-P-FLOOR-01): this file previously had no tier
 * enforcement — any authenticated shop on any plan (incl. free Starter)
 * could read/write full warehouse layout data. Tier check restored to
 * match the wms.routes.ts pattern: authenticateToken → requireFt2 →
 * requireTier → requireAction.
 *
 * FEAT-002: Extend with POST /zones, PATCH /zones/:code/barcode, etc.
 * once barcode column is added to warehouse_locations.
 */
const router = Router();

router.get(
  '/layout',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:read'),
  httpGetLayout
);

router.patch(
  '/products/:lasyncroVariantId/barcode',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:write'),
  httpUpdateProductBarcode
);

router.post(
  '/zones',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:write'),
  httpCreateZone
);

router.patch(
  '/zones/:locationCode',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:write'),
  httpUpdateZone
);

router.delete(
  '/zones/:locationCode',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:write'),
  httpDeleteZone
);

router.get(
  '/grid',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:read'),
  httpGetGrid
);

router.get(
  '/grid/occupancy',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:read'),
  httpGetBinOccupancy
);

router.get(
  '/bin/:locationCode/log',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:read'),
  httpGetBinLog
);

router.get(
  '/bin/:locationCode/stats',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:read'),
  httpGetBinStats
);

router.get(
  '/variant/:variantId/bins',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:read'),
  httpGetVariantBins
);

router.post(
  '/zones/:locationCode/print',
  authenticateToken,
  requireFt2,
  requireTier('scale'),
  requireAction('floor-planning:write'),
  httpPrintBarcode
);

export default router;