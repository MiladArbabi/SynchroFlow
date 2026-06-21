// apps/backend/src/api/suppliers/suppliers.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import {
  httpGetSuppliers,
  httpCreateSupplier,
  httpUpdateSupplier,
  httpDeleteSupplier,
  httpGetPurchaseOrders,
  httpCreatePurchaseOrder,
  httpGetPoLineItems,
  httpUpdatePoStatus,
  httpReceiveShipment,
  httpPatchPurchaseOrder,
  httpSearchVariants,
} from './suppliers.controller.js';
import {
  httpListReceiveJobs,
  httpCreateReceiveJob,
  httpGetReceiveJob,
  httpClaimReceiveJob,
  httpInspectReceiveJobLine,
  httpCloseReceiveJob,
  httpReportReceiveException,
} from './receiveJob.controller.js';

/**
 * SUPPLIERS PORTAL ROUTES
 * ------------------------
 * All routes require FT2 lifecycle and owner/admin role.
 * Operators do not manage suppliers or POs.
 *
 * Supplier rating recompute is triggered automatically
 * on PO status transition to received/partially_received.
 */
const router = Router();

// ── VARIANTS SEARCH (PO line item autocomplete) ────────
router.get(
  '/variants/search',
  authenticateToken,
  requireFt2,
  httpSearchVariants
);

// ── SUPPLIERS ──────────────────────────────────────────
router.get(
  '/',
  authenticateToken,
  requireFt2,
  requireAction('suppliers:read'),
  httpGetSuppliers
);

router.post(
  '/',
  authenticateToken,
  requireFt2,
  requireAction('suppliers:write'),
  httpCreateSupplier
);
router.patch(
  '/:id',
  authenticateToken,
  requireFt2,
  requireAction('suppliers:write'),
  httpUpdateSupplier
);
router.delete(
  '/:id',
  authenticateToken,
  requireFt2,
  requireAction('suppliers:write'),
  httpDeleteSupplier
);

// ── PURCHASE ORDERS ────────────────────────────────────
router.get(
  '/purchase-orders',
  authenticateToken,
  requireFt2,
  requireAction('po:read'),
  httpGetPurchaseOrders
);

router.post(
  '/purchase-orders',
  authenticateToken,
  requireFt2,
  requireAction('po:write'),
  httpCreatePurchaseOrder
);

router.get(
  '/purchase-orders/:poId/line-items',
  authenticateToken,
  requireFt2,
  requireAction('po:read'),
  httpGetPoLineItems
);

router.patch(
  '/purchase-orders/:poId/status',
  authenticateToken,
  requireFt2,
  requireAction('po:status'),
  httpUpdatePoStatus
);

router.patch(
  '/purchase-orders/:poId',
  authenticateToken,
  requireFt2,
  requireAction('po:write'),
  httpPatchPurchaseOrder
);

router.post(
  '/purchase-orders/:poId/receive',
  authenticateToken,
  requireFt2,
  requireAction('po:receive'),
  httpReceiveShipment
);

// ── RECEIVE JOBS ───────────────────────────────────────────
router.get(
  '/receive-jobs',
  authenticateToken,
  requireFt2,
  requireAction('receive-job:read'),
  httpListReceiveJobs
);

// ── RECEIVE JOBS (FEAT-004) ────────────────────────────
router.post(
  '/purchase-orders/:poId/receive-jobs',
  authenticateToken,
  requireFt2,
  requireAction('receive-job:create'),
  httpCreateReceiveJob
);
router.get(
  '/receive-jobs/:jobId',
  authenticateToken,
  requireFt2,
  requireAction('receive-job:read'),
  httpGetReceiveJob
);
router.post(
  '/receive-jobs/:jobId/claim',
  authenticateToken,
  requireFt2,
  requireAction('receive-job:read'),
  httpClaimReceiveJob
);
router.post(
  '/receive-jobs/:jobId/inspect',
  authenticateToken,
  requireFt2,
  requireAction('receive-job:inspect'),
  httpInspectReceiveJobLine
);
router.post(
  '/receive-jobs/:jobId/close',
  authenticateToken,
  requireFt2,
  requireAction('receive-job:close'),
  httpCloseReceiveJob
);

router.post(
  '/receive-jobs/:jobId/exception',
  authenticateToken,
  requireFt2,
  requireAction('receive-job:exception'),
  httpReportReceiveException
);

export default router;