// apps/backend/src/api/floor-planning/floor-planning.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireCapability } from '../../middleware/require-entitlement.middleware.js';
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
  httpUpdateZonePositions,
  httpPrintBarcode,
  httpBatchPrintBarcodes,
  httpPrintProductBarcode,
  httpBatchPrintProductBarcodes
} from './floor-planning.controller.js';

/**
 * FLOOR PLANNING ROUTES
 * ----------------------
 * All routes require FT2 lifecycle, the warehouse.floor_planning commercial
 * capability, and owner/admin role. Operators do not manage floor layout.
 *
 * SECURITY FIX (audit ISS-P-FLOOR-01): this file previously had no tier
 * enforcement. Commercial gate wired to match the wms.routes.ts pattern:
 * authenticateToken → requireFt2 → requireCapability → requireAction.
 *
 * TIER HISTORY: scale → growth (2026-07-14) → starter (FP-GATE1) →
 * warehouse.floor_planning capability (COMMERCIAL-ACCESS-ARCH-01 P0-A2A).
 *
 * P0-A2A: the route-level gate is the canonical warehouse.floor_planning
 * capability (moduleId: floor-planning, minimumTier: growth). This closes the
 * audited commercial leak — Starter/Core now DENY, Growth/Scale ALLOW. The
 * earlier FP-GATE1 rationale for pinning every route to Starter is superseded
 * by that ratified policy.
 *
 * The field-level Growth guard in the controller (spatial geometry —
 * position_x/y, width, depth, orientation, rack_levels — enforced inside
 * httpCreateZone/httpUpdateZone via meetsTier) is retained; with a Growth
 * route gate it is now redundant but harmless.
 *
 * REV-HARD-01: the `barcode` column exists but is an optional merchant
 * override, not a printability precondition — labels render from location_code.
 */
const router = Router();

router.get(
  '/layout',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:read'),
  httpGetLayout
);

router.patch(
  '/products/:lasyncroVariantId/barcode',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:write'),
  httpUpdateProductBarcode
);

router.post(
  '/zones',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:write'),
  httpCreateZone
);

router.patch(
  '/zones/positions',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:write'),
  httpUpdateZonePositions
);

router.patch(
  '/zones/:locationCode',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:write'),
  httpUpdateZone
);

router.delete(
  '/zones/:locationCode',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:write'),
  httpDeleteZone
);

router.get(
  '/grid',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:read'),
  httpGetGrid
);

router.get(
  '/grid/occupancy',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:read'),
  httpGetBinOccupancy
);

router.get(
  '/bin/:locationCode/log',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:read'),
  httpGetBinLog
);

router.get(
  '/bin/:locationCode/stats',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:read'),
  httpGetBinStats
);

router.get(
  '/variant/:variantId/bins',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:read'),
  httpGetVariantBins
);

router.post(
  '/zones/:locationCode/print',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:write'),
  httpPrintBarcode
);

router.post(
  '/zones/print-batch',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:write'),
  httpBatchPrintBarcodes
);

// SHOP-REV-01g: product label print. Mirrors /zones/:locationCode/print —
// same starter tier, same floor-planning:write action. Label printing is
// never metered (R-BILL1), and product barcodes are as fundamental to the
// Starter WMS pipeline as location labels: without them the scan-based
// pick/pack/receive flow has nothing to scan.
router.post(
  '/products/:lasyncroVariantId/print',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:write'),
  httpPrintProductBarcode
);

router.post(
  '/products/print-batch',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.floor_planning'),
  requireAction('floor-planning:write'),
  httpBatchPrintProductBarcodes
);

export default router;