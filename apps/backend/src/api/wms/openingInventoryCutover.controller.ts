// apps/backend/src/api/wms/openingInventoryCutover.controller.ts
import { Request, Response } from 'express';
import { startShopOpeningInventory } from '../../services/wms/shopifyOpeningInventorySnapshot.service.js';
import {
  approveAndRunOpeningInventoryCutover,
  classifyOpeningInventoryCutoverError,
  getOpeningInventoryCutoverView,
  type OpeningInventoryCutoverErrorCode,
} from '../../services/wms/openingInventoryCutover.service.js';

/**
 * Opening inventory cutover HTTP boundary (4b-2b GRILL-03).
 *
 * Thin by design. openingInventoryCutover.service.ts owns owner/admin
 * membership, readiness, explicit physical-truth acceptance, the immutable
 * economic delta, Shopify preflight, durable batches, idempotency, retries,
 * completion and concurrency. This controller only:
 *   - takes shop/user identity exclusively from req.user;
 *   - validates the cutover POST's single client input (accept_physical_truth);
 *   - maps the service's public error classification to HTTP status.
 * Any other body field (shop/user/role/delta/location/variants) is ignored.
 * GH-1156 adds the thin start bridge; #1164 gives it exactly one client input,
 * the explicit assigned_to operator. Identity, scope and economics remain
 * server-authoritative there too.
 */

const CUTOVER_ERROR_STATUS: Record<OpeningInventoryCutoverErrorCode, number> = {
  OPENING_CUTOVER_FORBIDDEN: 403,
  OPENING_CUTOVER_NOT_READY: 409,
  OPENING_CUTOVER_ACCEPTANCE_REQUIRED: 409,
  OPENING_CUTOVER_PREFLIGHT: 409,
  OPENING_CUTOVER_LOCATION: 409,
  OPENING_CUTOVER_IDENTITY: 409,
  OPENING_CUTOVER_SHOPIFY: 502,
  OPENING_CUTOVER_EXECUTE: 502,
  OPENING_CUTOVER_INTERNAL: 500,
};

function respondCutoverError(
  res: Response,
  operation: 'READ' | 'APPROVE',
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error);

  // Shared pure classifier: only a leading stable prefix is authoritative,
  // and raw provider/runtime text never reaches the response body.
  const publicError = classifyOpeningInventoryCutoverError(error);

  console.error(`[OPENING_CUTOVER_${operation}_FAILED]`, { error: message });

  if (operation === 'READ') {
    return res.status(500).json({
      code: 'OPENING_CUTOVER_INTERNAL',
      error: 'Opening inventory progress could not be loaded',
    });
  }

  return res.status(CUTOVER_ERROR_STATUS[publicError.code]).json({
    code: publicError.code,
    error: publicError.message,
  });
}

export const httpGetOpeningInventoryProgress = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const view = await getOpeningInventoryCutoverView(Number(shopId));
    return res.json(view);
  } catch (error) {
    return respondCutoverError(res, 'READ', error);
  }
};

/**
 * GH-1156: merchant bridge from `not_started` to the canonical shop-wide
 * opening start. startShopOpeningInventory() owns the v2 bootstrap check, the
 * frozen bin cohort, the snapshot anchor and replay (an already-started shop
 * returns its existing progress, never reassigned). GH-1179: it also owns its
 * transactions, because counting may only begin after a complete Shopify
 * on_hand snapshot of the mapped Location is read outside any transaction.
 *
 * #1164: the only client input is `assigned_to`, a required positive integer
 * user id naming the operator the cohort is dispatched to; the service
 * validates it against active shop membership and recount-count permission.
 * Shop and creator identity come from req.user; warehouse, bins, cohort and
 * quantities are never client input, and any other body field is ignored.
 *
 * Service rejections are classified only by their leading prefix —
 * [OPENING_RECOUNT_SHOP_ASSIGNEE] (400), [OPENING_RECOUNT_SHOP_START] (409),
 * [OPENING_START_IN_PROGRESS] (409) and [OPENING_START_SHOPIFY_FAILED] (502) —
 * and raw service/provider text never reaches the response body.
 */
const OPENING_START_INVALID_REQUEST_MESSAGE =
  'Choose an operator before starting the opening count.';
const OPENING_START_INVALID_ASSIGNEE_MESSAGE =
  'The selected operator cannot perform inventory counts.';
const OPENING_START_REJECTED_MESSAGE =
  'The opening count could not be started. Check that your warehouse has active bins, then try again.';
const OPENING_START_INTERNAL_MESSAGE =
  'The opening count could not be started. Try again.';
const OPENING_START_IN_PROGRESS_MESSAGE =
  'Opening inventory is already preparing. Try again shortly.';
const OPENING_START_SHOPIFY_FAILED_MESSAGE =
  'Shopify inventory could not be read for your warehouse location. Try again.';

export const httpStartOpeningInventoryReconciliation = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const assignedTo = body.assigned_to;

  // #1164: initial Opening Inventory is explicitly dispatched to one
  // concrete operator. Unlike ordinary recount creation, first-claim
  // assignment is not valid for this one-time reconciliation program.
  if (
    typeof assignedTo !== 'number' ||
    !Number.isInteger(assignedTo) ||
    assignedTo <= 0
  ) {
    return res.status(400).json({
      code: 'OPENING_START_INVALID_REQUEST',
      error: OPENING_START_INVALID_REQUEST_MESSAGE,
    });
  }

  try {
    const progress = await startShopOpeningInventory({
      shopId: Number(shopId),
      createdBy: Number(userId),
      assignedTo,
    });
    return res.json(progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[OPENING_START_FAILED]', { error: message });

    if (message.startsWith('[OPENING_RECOUNT_SHOP_ASSIGNEE]')) {
      return res.status(400).json({
        code: 'OPENING_START_INVALID_ASSIGNEE',
        error: OPENING_START_INVALID_ASSIGNEE_MESSAGE,
      });
    }

    if (message.startsWith('[OPENING_RECOUNT_SHOP_START]')) {
      return res.status(409).json({
        code: 'OPENING_START_REJECTED',
        error: OPENING_START_REJECTED_MESSAGE,
      });
    }

    if (message.startsWith('[OPENING_START_IN_PROGRESS]')) {
      return res.status(409).json({
        code: 'OPENING_START_IN_PROGRESS',
        error: OPENING_START_IN_PROGRESS_MESSAGE,
      });
    }

    if (message.startsWith('[OPENING_START_SHOPIFY_FAILED]')) {
      return res.status(502).json({
        code: 'OPENING_START_SHOPIFY_FAILED',
        error: OPENING_START_SHOPIFY_FAILED_MESSAGE,
      });
    }

    return res.status(500).json({
      code: 'OPENING_START_INTERNAL',
      error: OPENING_START_INTERNAL_MESSAGE,
    });
  }
};

export const httpApproveOpeningInventoryCutover = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const body = (req.body ?? {}) as Record<string, unknown>;

  if (
    Object.prototype.hasOwnProperty.call(body, 'accept_physical_truth') &&
    typeof body.accept_physical_truth !== 'boolean'
  ) {
    return res.status(400).json({
      code: 'OPENING_CUTOVER_INVALID_REQUEST',
      error: 'accept_physical_truth must be a boolean when provided',
    });
  }

  try {
    const result = await approveAndRunOpeningInventoryCutover({
      shopId: Number(shopId),
      actingUserId: Number(userId),
      acceptPhysicalTruth: body.accept_physical_truth === true,
    });
    return res.json(result);
  } catch (error) {
    return respondCutoverError(res, 'APPROVE', error);
  }
};
