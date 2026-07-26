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
  httpPrintBarcode,
  httpBatchPrintBarcodes
} from './floor-planning.controller.js';

/**
 * FLOOR PLANNING ROUTES
 * ----------------------
 * All routes require FT2 lifecycle, Starter-tier subscription, and owner/admin
 * role. Operators do not manage floor layout.
 *
 * SECURITY FIX (audit ISS-P-FLOOR-01): this file previously had no tier
 * enforcement. Tier check restored to match the wms.routes.ts pattern:
 * authenticateToken → requireFt2 → requireTier → requireAction.
 *
 * TIER HISTORY: scale → growth (2026-07-14) → starter (FP-GATE1).
 *
 * FP-GATE1 — why every route is 'starter': Starter owns the full WMS
 * pipeline (wms.routes.ts, requireTier('starter')). Scanning, picking,
 * packing and stowing all resolve against warehouse locations, so gating
 * location reads/CRUD above Starter made the tier's headline capability
 * inoperable. Reads, non-spatial zone CRUD, and location-label printing
 * (never metered — R-BILL1) are Starter.
 *
 * The Growth gate has NOT disappeared — it moved into the controller.
 * Spatial geometry (position_x/y, width, depth, orientation, rack_levels)
 * is Canvas-only and still requires Growth, enforced field-level inside
 * httpCreateZone/httpUpdateZone because no dedicated spatial endpoint
 * exists (Canvas persists via looped PATCH /zones/:locationCode).
 * Do not re-raise these literals without moving that guard too.
 *
 * FEAT-002: Extend with POST /zones, PATCH /zones/:code/barcode, etc.
 * once barcode column is added to warehouse_locations.
 */
const router = Router();

router.get(
  '/layout',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:read'),
  httpGetLayout
);

router.patch(
  '/products/:lasyncroVariantId/barcode',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:write'),
  httpUpdateProductBarcode
);

router.post(
  '/zones',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:write'),
  httpCreateZone
);

router.patch(
  '/zones/:locationCode',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:write'),
  httpUpdateZone
);

router.delete(
  '/zones/:locationCode',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:write'),
  httpDeleteZone
);

router.get(
  '/grid',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:read'),
  httpGetGrid
);

router.get(
  '/grid/occupancy',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:read'),
  httpGetBinOccupancy
);

router.get(
  '/bin/:locationCode/log',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:read'),
  httpGetBinLog
);

router.get(
  '/bin/:locationCode/stats',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:read'),
  httpGetBinStats
);

router.get(
  '/variant/:variantId/bins',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:read'),
  httpGetVariantBins
);

router.post(
  '/zones/:locationCode/print',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:write'),
  httpPrintBarcode
);

router.post(
  '/zones/print-batch',
  authenticateToken,
  requireFt2,
  requireTier('starter'),
  requireAction('floor-planning:write'),
  httpBatchPrintBarcodes
);

export default router;