// apps/backend/src/api/wms/wms.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireRole } from '../../middleware/require-role.middleware.js';
import { requireTier } from '../../middleware/require-entitlement.middleware.js';
import {
  httpGetBatches,
  httpGetBatchLineItems,
  httpReleaseBatch,
  httpClaimBatch,
  httpCompletePick,
  httpReportPickException,
  httpResolveBarcode,
  httpConfirmPickScan,
  httpClaimPack,
  httpGetBatchOrders,
  httpConfirmPackScan,
  httpCompletePack,
  httpGetSkuGaps,
  httpResolveException,
  httpConfirmShipment,
  httpGetStowTasks,
  httpClaimStowTask,
  httpConfirmStow,
  httpCreateStowTask,
} from './wms.controller.js';
/**
 * WMS ROUTES (WM-03)
 * -------------------
 * All routes require FT2 lifecycle and authenticated user.
 *
 * Role guards (temporary until WM-19 entitlements sprint):
 * - batch/release — owner, admin only
 * - barcode/resolve — all roles (operator needs this)
 * - pick/scan — operator, owner, admin
 */

// WMS routes — all gated at Core tier minimum (MON-03).
// Tier enforcement: authenticateToken → requireFt2 → requireTier → requireRole
// Seat limit is the natural Scale differentiator — no Scale-only routes needed.
const router = Router();
router.get(
  '/batches',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpGetBatches
);
router.get(
  '/batch/:batchId/line-items',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpGetBatchLineItems
);
router.post(
  '/batch/release',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['owner', 'admin']),
  httpReleaseBatch
);
router.post(
  '/batch/:batchId/claim',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpClaimBatch
);
router.post(
  '/batch/:batchId/pick-complete',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpCompletePick
);
router.post(
  '/batch/:batchId/pack/claim',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpClaimPack
);
router.get(
  '/batch/:batchId/orders',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpGetBatchOrders
);
router.get(
  '/sku-gaps',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['owner', 'admin']),
  httpGetSkuGaps
);
router.get(
  '/stow-tasks',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpGetStowTasks
);
router.post(
  '/pack/scan',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpConfirmPackScan
);
router.post(
  '/batch/:batchId/pack-complete',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpCompletePack
);
router.post(
  '/batch/:batchId/exception',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpReportPickException
);
router.post(
  '/barcode/resolve',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpResolveBarcode
);
router.post(
  '/pick/scan',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpConfirmPickScan
);
router.post(
  '/sku-gaps/:exceptionId/resolve',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['owner', 'admin']),
  httpResolveException
);
router.post(
  '/batch/:batchId/ship',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpConfirmShipment
);
router.post(
  '/stow-tasks',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['owner', 'admin']),
  httpCreateStowTask
);
router.post(
  '/stow-tasks/:taskId/claim',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpClaimStowTask
);
router.post(
  '/stow-tasks/:taskId/confirm',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireRole(['operator', 'owner', 'admin']),
  httpConfirmStow
);

export default router;