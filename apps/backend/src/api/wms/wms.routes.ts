// apps/backend/src/api/wms/wms.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireRole } from '../../middleware/require-role.middleware.js';
import {
  httpGetBatches,
  httpReleaseBatch,
  httpClaimBatch,
  httpCompletePick,
  httpReportPickException,
  httpResolveBarcode,
  httpConfirmPickScan,
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
const router = Router();

router.get(
  '/batches',
  authenticateToken,
  requireFt2,
  requireRole(['operator', 'owner', 'admin']),
  httpGetBatches
);

router.post(
  '/batch/release',
  authenticateToken,
  requireFt2,
  requireRole(['owner', 'admin']),
  httpReleaseBatch
);

router.post(
  '/batch/:batchId/claim',
  authenticateToken,
  requireFt2,
  requireRole(['operator', 'owner', 'admin']),
  httpClaimBatch
);

router.post(
  '/batch/:batchId/pick-complete',
  authenticateToken,
  requireFt2,
  requireRole(['operator', 'owner', 'admin']),
  httpCompletePick
);

router.post(
  '/batch/:batchId/exception',
  authenticateToken,
  requireFt2,
  requireRole(['operator', 'owner', 'admin']),
  httpReportPickException
);

router.post(
  '/barcode/resolve',
  authenticateToken,
  requireFt2,
  requireRole(['operator', 'owner', 'admin']),
  httpResolveBarcode
);

router.post(
  '/pick/scan',
  authenticateToken,
  requireFt2,
  requireRole(['operator', 'owner', 'admin']),
  httpConfirmPickScan
);

export default router;