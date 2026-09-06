// apps/backend/src/api/wms/wms.routes.ts
import { Router } from 'express';
import { authenticateToken } from '@lasyncro/backend-core/middleware/auth.middleware.js';
import { requireFt2 } from '../../middleware/require-ft2.middleware.js';
import { requireAction } from '../../middleware/require-action.middleware.js';
import { requireTier, requireCapability } from '../../middleware/require-entitlement.middleware.js';
import {
  httpGetBatches,
  httpGetBatchLineItems,
  httpReleaseBatch,
  httpCancelBatch,
  httpClaimBatch,
  httpCompletePick,
  httpReportPickException,
  httpResolveBarcode,
  httpConfirmPickScan,
  httpClaimPack,
  httpGetBatchOrders,
  httpGetReadyToPack,
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
  httpGetOrderInvoice,
  httpResolveLocation,
  httpGetOrderPool,
  httpScanResolve,
  httpCreateProblemTask,
  httpGetProblemTasks,
  httpFindReplacementForTask,
  httpReportStowException,
  httpGetWmsSettings,
  httpUpsertCarrierSettings,
  httpGetCarrierSettings,
  httpDeleteCarrierSettings,
  httpGenerateShippingLabel,
  httpGetUnitLabels,
  httpGetUnitLabelCoverage,
  httpResolveProblemTask,
  httpPatchWmsSettings,
  httpSetOrderPriority,
  httpRaisePackDecision,
  httpGetPackDecision,
  httpResolvePackDecision,
  httpListPackDecisions,
  httpPackFreeScan,
  httpBulkGenerateShippingLabels,
  httpGetLiveActivity,
} from './wms.controller.js';
import { httpGetPackedHandoffQueue } from './wms.handoff.controller.js';
import {
  httpGetPickAnalytics,
  httpGetLiveCapacity,
  httpGetOperatorPerformance,
  httpGetPipelineVelocity,
  httpGetExceptionIntelligence,
  httpGetCostStory,
  httpGetActivityStream,
  httpGetDisplayData,
  httpDisplayHeartbeat,
  httpCreateDisplayToken,
  httpListDisplayTokens,
  httpPatchDisplayToken,
  httpRotateDisplayToken,
  httpRevokeDisplayToken,
} from './wms.analytics.controller.js';
import { 
  httpListPrinters, 
  httpCreatePrinter, 
  httpUpdatePrinter, 
  httpDeletePrinter, 
  httpGetDefaultPrinter 
} from './printers.controller.js';
import {
  httpCreateCarrierWebhookToken,
  httpGetCarrierWebhookToken,
  httpRotateCarrierWebhookToken,
  httpRevokeCarrierWebhookToken,
  httpSetCarrierWebhookSecret,
} from './carrierWebhookToken.controller.js';
import {
  httpListSenderAddresses,
  httpCreateSenderAddress,
  httpUpdateSenderAddress,
  httpDeleteSenderAddress,
} from './senderAddress.controller.js';
import {
  httpCreateRecountTask,
  httpClaimRecountTask,
  httpReassignRecountTask,
  httpGetRecountLines,
  httpRecordRecountLine,
  httpCloseRecountTask,
  httpReviewRecountLine,
  httpCommitRecountTask,
  httpListRecountTasks,
  httpSkipRecountLine,
  httpCreateRecountFinding,
  httpListRecountFindings,
  httpPreviewSuggestedBins,
} from './inventoryRecount.controller.js';

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
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetBatches
);
router.get(
  '/batch/:batchId/line-items',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetBatchLineItems
);
router.post(
  '/batch/release',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:batch:release'),
  httpReleaseBatch
);
router.post(
  '/batch/:batchId/cancel',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:batch:release'),
  httpCancelBatch
);

router.post(
  '/batch/:batchId/claim',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:batch:claim'),
  httpClaimBatch
);

router.post(
  '/batch/:batchId/pick-complete',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:pick:scan'),
  httpCompletePick
);
router.post(
  '/batch/:batchId/pack/claim',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:pack:scan'),
  httpClaimPack
);
router.get(
  '/batch/:batchId/orders',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetBatchOrders
);
router.get(
  '/batches/ready-to-pack',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetReadyToPack
);

router.get(
  '/problem-center/pick-exceptions',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.problem_center'),
  requireAction('wms:read'),
  httpGetProblemCenterExceptions
);

router.get(
  '/stow-tasks',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetStowTasks
);
router.post(
  '/pack/scan',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:pack:scan'),
  httpConfirmPackScan
);
router.post(
  '/pack/free-scan',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:pack:scan'),
  httpPackFreeScan
);
router.post(
  '/batch/:batchId/pack-complete',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:pack:scan'),
  httpCompletePack
);
router.post(
  '/batch/:batchId/exception',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:exception:report'),
  httpReportPickException
);
router.post(
  '/barcode/resolve',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpResolveBarcode
);
router.post(
  '/pick/scan',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:pick:scan'),
  httpConfirmPickScan
);
// Resolves a pick exception under problem-center domain
router.post(
  '/problem-center/pick-exceptions/:exceptionId/resolve',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.problem_center'),
  requireAction('wms:exception:report'),
  httpResolveException
);

// Resolve a problem_center_tasks row (re_stow / discard / return / write_off)
//
// PC-TIER-GATE-01: starter, not core. cancellationUnwind.service.ts runs in
// the projection worker with no entitlement middleware, so it raises
// problem_center_tasks rows for any tenant whose batch release (starter) and
// pick scan (starter) are entitled. Gating resolution above the tier that
// generates the row strands the physical unit permanently — the reservation
// is already released and no stow task can ever be created to recover it.
// The recovery path this hands off to (/stow-tasks/:taskId/claim|confirm) is
// starter, so this is the only gate on the chain.
router.post(
  '/problem-center/:taskId/resolve',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:exception:report'),
  httpResolveProblemTask
);

router.get(
  '/outbound/handoff-queue',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetPackedHandoffQueue
);

router.post(
  '/batch/:batchId/ship',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:ship:confirm'),
  httpConfirmShipment
);
router.post(
  '/stow-tasks',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:stow:location'),
  httpCreateStowTask
);
router.post(
  '/stow-tasks/:taskId/claim',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:stow:claim'),
  httpClaimStowTask
);
router.post(
  '/stow-tasks/:taskId/confirm',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:stow:confirm'),
  httpConfirmStow
);

router.patch(
  '/stow-tasks/:taskId/location',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:stow:location'),
  httpAssignStowLocation
);

router.get(
  '/orders/:orderId/packing-slip',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetPackingSlipUrl
);

router.get(
  '/orders/:orderId/invoice',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetOrderInvoice
);

router.post(
  '/orders/:orderId/priority',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:batch:release'),
  httpSetOrderPriority
);

router.post(
  '/location/resolve',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpResolveLocation
);

router.get(
  '/order-pool',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetOrderPool
);

router.post(
  '/scan/resolve',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpScanResolve
);

router.post(
  '/problem-center',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.problem_center'),
  requireAction('wms:exception:report'),
  httpCreateProblemTask
);

// PC-TIER-GATE-01: starter. A tenant must be able to SEE work the system
// generated on its behalf. Resolving a task it cannot list is an API-only
// fix — the merchant surface stays broken. Discretionary creation
// (POST /problem-center), pick-exceptions and the replacement finder remain
// core; only the see-and-clear pair is dropped.
router.get(
  '/problem-center',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetProblemTasks
);

router.get(
  '/problem-center/:taskId/replacement',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.problem_center'),
  requireAction('wms:read'),
  httpFindReplacementForTask
);

router.post(
  '/stow-tasks/:taskId/exception',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:exception:report'),
  httpReportStowException
);

router.patch(
  '/settings',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpPatchWmsSettings
);

router.get(
  '/settings',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
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
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpGetPickAnalytics
);

router.get(
  '/analytics/live',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpGetLiveCapacity
);

router.get(
  '/analytics/operators',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpGetOperatorPerformance
);

router.get(
  '/analytics/pipeline',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpGetPipelineVelocity
);

router.get(
  '/analytics/exceptions',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpGetExceptionIntelligence
);

router.get(
  '/analytics/cost',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpGetCostStory
);

router.get(
  '/analytics/activity-stream',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpGetActivityStream
);

router.get('/analytics/display', httpGetDisplayData);
router.post('/analytics/display/heartbeat', httpDisplayHeartbeat);

router.post(
  '/analytics/display-tokens',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpCreateDisplayToken
);
router.get(
  '/analytics/display-tokens',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpListDisplayTokens
);
router.patch(
  '/analytics/display-tokens/:id',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpPatchDisplayToken
);
router.post(
  '/analytics/display-tokens/:id/rotate',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpRotateDisplayToken
);
router.delete(
  '/analytics/display-tokens/:id',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpRevokeDisplayToken
);

// ─── PACK DECISION REQUESTS ───────────────────────────────────────────────────
// Operator raises blocking decision → owner resolves → packer proceeds.
router.post(
  '/pack/decision-request',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:pack:scan'),
  httpRaisePackDecision
);
router.get(
  '/pack/decision-request/:requestId',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetPackDecision
);
router.post(
  '/pack/decision-request/:requestId/resolve',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:batch:release'),
  // wms:batch:release is the existing owner-only action gate
  httpResolvePackDecision
);

router.get(
  '/pack/decision-requests',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:batch:release'),
  httpListPackDecisions
);
router.put(
  '/carrier-settings',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:batch:release'),
  httpUpsertCarrierSettings
);
router.get(
  '/carrier-settings',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetCarrierSettings
);
router.delete(
  '/carrier-settings/:carrierCode',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:batch:release'),
  httpDeleteCarrierSettings
);
router.post(
  '/orders/:orderId/generate-label',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:pack:scan'),
  httpGenerateShippingLabel
);
router.get(
  '/receive-job-lines/:lineId/unit-labels',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetUnitLabels
);
router.get(
  '/coverage',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:read'),
  httpGetUnitLabelCoverage
);

router.get(
  '/printers', 
  authenticateToken, 
  requireFt2, 
  requireCapability('warehouse.operations'),
  requireAction('wms:read'), 
  httpListPrinters
);

router.post(
  '/printers', 
  authenticateToken, 
  requireFt2, 
  requireCapability('warehouse.operations'),
  requireAction('wms:settings:write'), 
  httpCreatePrinter
);

router.patch(
  '/printers/:printerId', 
  authenticateToken, 
  requireFt2, 
  requireCapability('warehouse.operations'),
  requireAction('wms:settings:write'), 
  httpUpdatePrinter
);

router.delete(
  '/printers/:printerId', 
  authenticateToken, 
  requireFt2, 
  requireCapability('warehouse.operations'),
  requireAction('wms:settings:write'), 
  httpDeletePrinter
);

router.get(
  '/printers/default/:role', 
  authenticateToken, 
  requireFt2, 
  requireCapability('warehouse.operations'),
  requireAction('wms:read'), 
  httpGetDefaultPrinter
);

router.put(
  '/carrier-webhook-tokens',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:batch:release'),
  httpCreateCarrierWebhookToken
);
router.get(
  '/carrier-webhook-tokens',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:read'),
  httpGetCarrierWebhookToken
);
router.post(
  '/carrier-webhook-tokens/:id/rotate',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:batch:release'),
  httpRotateCarrierWebhookToken
);
router.delete(
  '/carrier-webhook-tokens/:id',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:batch:release'),
  httpRevokeCarrierWebhookToken
);
router.patch(
  '/carrier-settings/:carrierCode/webhook-secret',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.analytics'),
  requireAction('wms:batch:release'),
  httpSetCarrierWebhookSecret
);

router.post(
  '/orders/bulk-generate-label',
  authenticateToken,
  requireFt2,
  requireCapability('warehouse.operations'),
  requireAction('wms:pack:scan'),
  httpBulkGenerateShippingLabels
);

router.get(
  '/sender-addresses',
  authenticateToken, requireFt2, requireTier('core'), requireAction('wms:read'),
  httpListSenderAddresses
);
router.post(
  '/sender-addresses',
  authenticateToken, requireFt2, requireTier('core'), requireAction('wms:batch:release'),
  httpCreateSenderAddress
);
router.patch(
  '/sender-addresses/:id',
  authenticateToken, requireFt2, requireTier('core'), requireAction('wms:batch:release'),
  httpUpdateSenderAddress
);
router.delete(
  '/sender-addresses/:id',
  authenticateToken, requireFt2, requireTier('core'), requireAction('wms:batch:release'),
  httpDeleteSenderAddress
);

// Inventory recount is Core inventory correctness, not an advanced analytics feature.
// P0-A3-4: the commercial half is the canonical `inventory.core` capability
// (module `products` + Core+), replacing the legacy raw tier gate.
// requireFt2 and the per-route requireAction RBAC are unchanged — commercial
// entitlement and role permission remain two separate, both-required axes.
router.post(
  '/recount-tasks',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:create'),
  httpCreateRecountTask
);

router.get(
  '/recount-tasks',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:read'),
  httpListRecountTasks
);

router.get(
  '/recount-tasks/preview',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:read'),
  httpPreviewSuggestedBins
);

router.get(
  '/recount-tasks/:taskId/lines',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:read'),
  httpGetRecountLines
);

router.get(
  '/recount-tasks/:taskId/findings',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:read'),
  httpListRecountFindings
);

router.post(
  '/recount-tasks/:taskId/findings',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:count'),
  httpCreateRecountFinding
);

router.post(
  '/recount-tasks/:taskId/claim',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:claim'),
  httpClaimRecountTask
);

// RECOUNT-CLAIM-ABANDONED-131: explicit owner/admin recovery for an
// abandoned claimed/counting task. requireAction enforces the ACTING user is
// owner/admin; the target operator's own eligibility is validated inside
// reassignRecountTask (service layer), since middleware can only check the
// requesting user, not an arbitrary target.
router.post(
  '/recount-tasks/:taskId/reassign',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:reassign'),
  httpReassignRecountTask
);

router.post(
  '/recount-tasks/:taskId/lines/:lineId/count',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:count'),
  httpRecordRecountLine
);

router.post(
  '/recount-tasks/:taskId/lines/:lineId/skip',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:count'),
  httpSkipRecountLine
);

router.post(
  '/recount-tasks/:taskId/close',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:count'),
  httpCloseRecountTask
);

router.post(
  '/recount-tasks/:taskId/lines/:lineId/review',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:review'),
  httpReviewRecountLine
);

router.post(
  '/recount-tasks/:taskId/commit',
  authenticateToken,
  requireFt2,
  requireCapability('inventory.core'),
  requireAction('wms:recount:commit'),
  httpCommitRecountTask
);

router.get(
  '/live-activity',
  authenticateToken, requireFt2, requireCapability('overview.live_map'), requireAction('wms:read'),
  httpGetLiveActivity
);

export default router;
