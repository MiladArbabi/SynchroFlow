// apps/backend/src/api/wms/openingInventoryCutover.controller.ts
import { Request, Response } from 'express';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { startShopOpeningInventoryReconciliation } from '../../services/wms/inventoryRecount.service.js';
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
 *   - validates the single client input (accept_physical_truth);
 *   - maps the service's public error classification to HTTP status.
 * Any other body field (shop/user/role/delta/location/variants) is ignored.
 * GH-1156 adds the thin start bridge, which accepts no client input at all.
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
 * opening start. startShopOpeningInventoryReconciliation() owns the v2
 * bootstrap check, the frozen bin cohort, the snapshot anchor and replay
 * (an already-started shop returns its existing progress). The request body
 * is ignored entirely: shop, warehouse, bins, cohort and quantities are never
 * client input.
 *
 * Service rejections carry the leading [OPENING_RECOUNT_SHOP_START] prefix;
 * only that prefix is classified, and raw service text never reaches the
 * response body.
 */
const OPENING_START_REJECTED_MESSAGE =
  'The opening count could not be started. Check that your warehouse has active bins, then try again.';
const OPENING_START_INTERNAL_MESSAGE =
  'The opening count could not be started. Try again.';

export const httpStartOpeningInventoryReconciliation = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const progress = await withTenant(Number(shopId), (trx) =>
      startShopOpeningInventoryReconciliation(trx, {
        shopId: Number(shopId),
        createdBy: Number(userId),
      })
    );
    return res.json(progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[OPENING_START_FAILED]', { error: message });

    if (message.startsWith('[OPENING_RECOUNT_SHOP_START]')) {
      return res.status(409).json({
        code: 'OPENING_START_REJECTED',
        error: OPENING_START_REJECTED_MESSAGE,
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
