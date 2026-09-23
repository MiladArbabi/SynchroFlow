// apps/backend/src/api/wms/openingInventoryCutover.controller.ts
import { Request, Response } from 'express';
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
