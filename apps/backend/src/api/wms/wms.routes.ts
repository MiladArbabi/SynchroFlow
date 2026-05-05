// apps/backend/src/api/wms/wms.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
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
  httpGetProblemCenterExceptions,
  httpResolveException,
  httpConfirmShipment,
  httpGetStowTasks,
  httpClaimStowTask,
  httpConfirmStow,
  httpCreateStowTask,
  httpAssignStowLocation,
  httpGetPackingSlipUrl,
  httpResolveLocation,
  httpGetOrderPool,
  httpScanResolve,
  httpCreateProblemTask,
  httpGetProblemTasks,
  httpReportStowException,
  httpGetWmsSettings,
  httpResolveProblemTask,
  httpPatchWmsSettings,
} from './wms.controller.js';
import { httpGetPickAnalytics } from './wms.analytics.controller.js';

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
// Tier enforcement: authenticateToken → requireFt2 → requireTier → requireAction
// Seat limit is the natural Scale differentiator — no Scale-only routes needed.
const router = Router();
router.get(
  '/batches',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpGetBatches
);
router.get(
  '/batch/:batchId/line-items',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpGetBatchLineItems
);
router.post(
  '/batch/release',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:batch:release'),
  httpReleaseBatch
);
router.post(
  '/batch/:batchId/claim',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:batch:claim'),
  httpClaimBatch
);
router.post(
  '/batch/:batchId/pick-complete',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:pick:scan'),
  httpCompletePick
);
router.post(
  '/batch/:batchId/pack/claim',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:pack:scan'),
  httpClaimPack
);
router.get(
  '/batch/:batchId/orders',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpGetBatchOrders
);

router.get(
  '/problem-center/pick-exceptions',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpGetProblemCenterExceptions
);

router.get(
  '/stow-tasks',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpGetStowTasks
);
router.post(
  '/pack/scan',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:pack:scan'),
  httpConfirmPackScan
);
router.post(
  '/batch/:batchId/pack-complete',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:pack:scan'),
  httpCompletePack
);
router.post(
  '/batch/:batchId/exception',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:exception:report'),
  httpReportPickException
);
router.post(
  '/barcode/resolve',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpResolveBarcode
);
router.post(
  '/pick/scan',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:pick:scan'),
  httpConfirmPickScan
);
// Resolves a pick exception under problem-center domain
router.post(
  '/problem-center/pick-exceptions/:exceptionId/resolve',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:exception:report'),
  httpResolveException
);

// Resolve a problem_center_tasks row (re_stow / discard / return / write_off)
router.post(
  '/problem-center/:taskId/resolve',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:exception:report'),
  httpResolveProblemTask
);

router.post(
  '/batch/:batchId/ship',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:ship:confirm'),
  httpConfirmShipment
);
router.post(
  '/stow-tasks',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:stow:location'),
  httpCreateStowTask
);
router.post(
  '/stow-tasks/:taskId/claim',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:stow:claim'),
  httpClaimStowTask
);
router.post(
  '/stow-tasks/:taskId/confirm',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:stow:confirm'),
  httpConfirmStow
);

router.patch(
  '/stow-tasks/:taskId/location',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:stow:location'),
  httpAssignStowLocation
);

router.get(
  '/orders/:orderId/packing-slip',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpGetPackingSlipUrl
);

router.post(
  '/location/resolve',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpResolveLocation
);

router.get(
  '/order-pool',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpGetOrderPool
);

router.post(
  '/scan/resolve',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpScanResolve
);

router.post(
  '/problem-center',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:exception:report'),
  httpCreateProblemTask
);

router.get(
  '/problem-center',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpGetProblemTasks
);

router.post(
  '/stow-tasks/:taskId/exception',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:exception:report'),
  httpReportStowException
);

router.patch(
  '/settings',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpPatchWmsSettings
);

router.get(
  '/settings',
  authenticateToken,
  requireFt2,
  requireTier('core'),
  requireAction('wms:read'),
  httpGetWmsSettings
);

/**
 * @route   GET /api/v1/wms/analytics
 * @desc    Pick analytics — accuracy, velocity, error rate by SKU, batch times
 * @access  Private — FT2, Growth tier, wms:read action
 */
router.get(
  '/analytics',
  authenticateToken,
  requireFt2,
  requireTier('growth'),
  requireAction('wms:read'),
  httpGetPickAnalytics
);

export default router;