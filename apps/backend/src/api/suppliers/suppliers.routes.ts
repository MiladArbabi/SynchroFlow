// apps/backend/src/api/suppliers/suppliers.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireCapability } from '../../middleware/require-entitlement.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import { requireReceiveJobOwner } from '../../middleware/require-receive-job-owner.middleware.js';
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
  httpGetSourcingRecommendations,
  httpGetNeverOrderedVariants,
  httpGetSourcingWorklist,
} from './sourcingRecommendations.controller.js';
import {
  httpListPreferences,
  httpCreatePreference,
  httpUpdatePreference,
  httpDeletePreference,
} from './supplierPreferences.controller.js';
import {
  httpListReceiveJobs,
  httpCreateReceiveJob,
  httpGetReceiveJob,
  httpClaimReceiveJob,
  httpAssignReceiveJob,
  httpUpdateReceiveJobLineProgress,
  httpConfirmReceiveJobLineCount,
  httpInspectReceiveJobLine,
  httpCloseReceiveJob,
  httpReportReceiveException,
} from './receiveJob.controller.js';
import {
  httpGetReceiveReconciliation,
  httpSaveReceiveReconciliationDraft,
  httpFinalizeReceiveReconciliation,
} from './receiveReconciliation.controller.js';
import { 
  httpConvertReorderRequests, 
  httpListReorderRequests, 
  httpCreateReorderRequest, 
  httpDeleteReorderRequest 
} from './reorderRequests.controller.js';

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
  requireCapability('purchasing.core'),
  httpSearchVariants
);

// ── SUPPLIERS ──────────────────────────────────────────
router.get(
  '/',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('suppliers:read'),
  httpGetSuppliers
);

router.post(
  '/',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('suppliers:write'),
  httpCreateSupplier
);
router.patch(
  '/:id',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('suppliers:write'),
  httpUpdateSupplier
);
router.delete(
  '/:id',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('suppliers:write'),
  httpDeleteSupplier
);

// ── PURCHASE ORDERS ────────────────────────────────────
router.get(
  '/purchase-orders',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('po:read'),
  httpGetPurchaseOrders
);

router.post(
  '/purchase-orders',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('po:write'),
  httpCreatePurchaseOrder
);

router.get(
  '/purchase-orders/:poId/line-items',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('po:read'),
  httpGetPoLineItems
);

router.patch(
  '/purchase-orders/:poId/status',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('po:status'),
  httpUpdatePoStatus
);

router.patch(
  '/purchase-orders/:poId',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('po:write'),
  httpPatchPurchaseOrder
);

router.post(
  '/purchase-orders/:poId/receive',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('po:receive'),
  httpReceiveShipment
);

// ── RECEIVE JOBS ───────────────────────────────────────────
router.get(
  '/receive-jobs',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:read'),
  httpListReceiveJobs
);

// ── RECEIVE JOBS (FEAT-004) ────────────────────────────
router.post(
  '/purchase-orders/:poId/receive-jobs',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:create'),
  // Dispatch authority is deliberately separate from execution authority.
  // Existing shops may retain historical receive-job:create permission rows,
  // so the new immutable assignment action is the hard owner/admin boundary.
  requireAction('receive-job:assign'),
  httpCreateReceiveJob
);
router.get(
  '/receive-jobs/:jobId',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:read'),
  httpGetReceiveJob
);
router.post(
  '/receive-jobs/:jobId/claim',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:read'),
  httpClaimReceiveJob
);
router.patch(
  '/receive-jobs/:jobId/assignment',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:assign'),
  httpAssignReceiveJob
);
router.patch(
  '/receive-jobs/:jobId/lines/:lineId/progress',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:inspect'),
  requireReceiveJobOwner,
  httpUpdateReceiveJobLineProgress
);
// GH-1241 S3-A1 — explicit operator physical count; inspection requires it.
router.post(
  '/receive-jobs/:jobId/lines/:lineId/confirm-count',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:inspect'),
  requireReceiveJobOwner,
  httpConfirmReceiveJobLineCount
);
// GH-1241 S3-B — opt-in grouped reconciliation. Reads inherit job reads;
// draft/finalize inherit inspection and claimed-job ownership.
router.get(
  '/receive-jobs/:jobId/reconciliation',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:read'),
  httpGetReceiveReconciliation
);
router.put(
  '/receive-jobs/:jobId/reconciliation/draft',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:inspect'),
  requireReceiveJobOwner,
  httpSaveReceiveReconciliationDraft
);
router.post(
  '/receive-jobs/:jobId/reconciliation/finalize',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:inspect'),
  requireReceiveJobOwner,
  httpFinalizeReceiveReconciliation
);
router.post(
  '/receive-jobs/:jobId/inspect',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:inspect'),
  requireReceiveJobOwner,
  httpInspectReceiveJobLine
);
router.post(
  '/receive-jobs/:jobId/close',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:close'),
  requireReceiveJobOwner,
  httpCloseReceiveJob
);

router.post(
  '/receive-jobs/:jobId/exception',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.core'),
  requireAction('receive-job:exception'),
  requireReceiveJobOwner,
  httpReportReceiveException
);

// UNIFIED SOURCING WORKLIST (SOURCING-UX-COGNITIVE-01 Slice 2) — registered
// before /sourcing-recommendations/:variantId so the literal segment can
// never be shadowed by that param route.
router.get(
  '/sourcing-worklist',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.sourcing'),
  requireAction('suppliers:read'),
  httpGetSourcingWorklist
);

// SOURCING RECOMMENDATIONS (Thread C, sourcing-recommendation-playbook.md §6)
router.get(
  '/sourcing-recommendations/never-ordered',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.sourcing'),
  requireAction('suppliers:read'),
  httpGetNeverOrderedVariants
);
router.get(
  '/sourcing-recommendations/:variantId',
  authenticateToken,
  requireFt2,
  requireCapability('purchasing.sourcing'),
  requireAction('suppliers:read'),
  httpGetSourcingRecommendations
);

// ── SUPPLIER-PRODUCT PREFERENCES (sourcing-recommendation-playbook.md §7) ──
router.get(
  '/preferences',
  authenticateToken, requireFt2, requireCapability('purchasing.sourcing'), requireAction('suppliers:read'),
  httpListPreferences
);
router.post(
  '/preferences',
  authenticateToken, requireFt2, requireCapability('purchasing.sourcing'), requireAction('suppliers:write'),
  httpCreatePreference
);
router.patch(
  '/preferences/:id',
  authenticateToken, requireFt2, requireCapability('purchasing.sourcing'), requireAction('suppliers:write'),
  httpUpdatePreference
);
router.delete(
  '/preferences/:id',
  authenticateToken, requireFt2, requireCapability('purchasing.sourcing'), requireAction('suppliers:write'),
  httpDeletePreference
);

// ── REORDER REQUESTS / MOQ ACCUMULATOR (sourcing-recommendation-playbook.md §8) ──
// convert must be registered before :id to avoid route shadowing
router.post(
  '/reorder-requests/convert',
  authenticateToken, requireFt2, requireCapability('purchasing.sourcing'), requireAction('suppliers:write'),
  httpConvertReorderRequests
);
router.get(
  '/reorder-requests',
  authenticateToken, requireFt2, requireCapability('purchasing.sourcing'), requireAction('suppliers:read'),
  httpListReorderRequests
);
router.post(
  '/reorder-requests',
  authenticateToken, requireFt2, requireCapability('purchasing.sourcing'), requireAction('suppliers:write'),
  httpCreateReorderRequest
);
router.delete(
  '/reorder-requests/:id',
  authenticateToken, requireFt2, requireCapability('purchasing.sourcing'), requireAction('suppliers:write'),
  httpDeleteReorderRequest
);

export default router;
