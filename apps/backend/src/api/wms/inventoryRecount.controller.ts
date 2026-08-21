// apps/backend/src/api/wms/inventoryRecount.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { getErrorMessage } from '@lasyncro/backend-core';
import { writeAuditLog } from '../../services/audit/operatorAudit.service.js';
import {
  createRecountTask,
  claimRecountTask,
  getOperatorLines,
  recordCount,
  closeCount,
  reviewLine,
  commitRecount,
  listRecountTasks,
} from '../../services/wms/inventoryRecount.service.js';

/**
 * Inventory recount HTTP boundary.
 *
 * Counting never mutates stock. Only commitRecount() may write correction
 * movements after owner/admin review. Blind expected quantities remain enforced
 * by inventoryRecount.service.ts rather than trusting the client.
 */
function recountErrorStatus(message: string): number {
  if (message.toLowerCase().includes('not found')) return 404;

  if (
    message.includes('requires') ||
    message.includes('must be') ||
    message.includes('No lines match')
  ) {
    return 400;
  }

  if (
    message === 'PROBLEM_BIN_NOT_CONFIGURED' ||
    message.includes('already claimed') ||
    message.includes('not claimable') ||
    message.includes('different operator') ||
    message.includes('not countable') ||
    message.includes('not closable') ||
    message.includes('not yet counted') ||
    message.includes('not in review') ||
    message.includes('not committable')
  ) {
    return 409;
  }

  return 500;
}

function respondRecountError(
  res: Response,
  operation: string,
  error: unknown,
) {
  const message = getErrorMessage(error);
  const status = recountErrorStatus(message);

  console.error(`[RECOUNT_${operation}_FAILED]`, { error: message });

  return res.status(status).json({
    error: status === 500
      ? `Inventory recount ${operation.toLowerCase()} failed: ${message}`
      : message,
  });
}

export const httpCreateRecountTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const {
    warehouse_id,
    scope,
    assigned_to,
    location_code,
    variant_ids,
    blind,
    notes,
  } = req.body ?? {};

  if (!warehouse_id || typeof warehouse_id !== 'string') {
    return res.status(400).json({ error: 'warehouse_id is required' });
  }

  const scopes = ['full', 'location', 'variant_set', 'suggested'];
  if (!scopes.includes(scope)) {
    return res.status(400).json({
      error: 'scope must be full, location, variant_set, or suggested',
    });
  }

  if (scope === 'location' && !location_code) {
    return res.status(400).json({
      error: 'location_code is required when scope=location',
    });
  }

  if (
    scope === 'variant_set' &&
    (!Array.isArray(variant_ids) || variant_ids.length === 0)
  ) {
    return res.status(400).json({
      error: 'variant_ids must be a non-empty array when scope=variant_set',
    });
  }

  if (
    assigned_to !== undefined &&
    assigned_to !== null &&
    (!Number.isInteger(assigned_to) || assigned_to <= 0)
  ) {
    return res.status(400).json({
      error: 'assigned_to must be a positive integer or null',
    });
  }

  if (blind !== undefined && typeof blind !== 'boolean') {
    return res.status(400).json({ error: 'blind must be a boolean' });
  }

  try {
    const task = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const created = await createRecountTask(trx, {
        shopId,
        warehouseId: warehouse_id,
        scope,
        createdBy: userId,
        assignedTo: assigned_to ?? null,
        locationCode: location_code,
        variantIds: variant_ids,
        blind,
        notes,
      });

      await writeAuditLog(trx, {
        shopId,
        operatorId: userId,
        actionType: 'recount_create',
        entityType: 'recount_task',
        entityId: created.recount_task_id,
        metadata: {
          label: created.label,
          scope,
          line_count: created.line_count,
          assigned_to: assigned_to ?? null,
        },
      });

      return created;
    });

    return res.status(201).json({ task });
  } catch (error) {
    return respondRecountError(res, 'CREATE', error);
  }
};

export const httpClaimRecountTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const recountTaskId = String(req.params.taskId ?? '');
  if (!recountTaskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      await claimRecountTask(trx, shopId, recountTaskId, userId);

      await writeAuditLog(trx, {
        shopId,
        operatorId: userId,
        actionType: 'recount_claim',
        entityType: 'recount_task',
        entityId: recountTaskId,
        metadata: { claimed_by: userId },
      });
    });

    return res.status(200).json({
      recount_task_id: recountTaskId,
      status: 'claimed',
    });
  } catch (error) {
    return respondRecountError(res, 'CLAIM', error);
  }
};

export const httpGetRecountLines = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const recountTaskId = String(req.params.taskId ?? '');
  if (!recountTaskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    const lines = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return getOperatorLines(trx, shopId, recountTaskId);
    });

    return res.status(200).json({ lines });
  } catch (error) {
    return respondRecountError(res, 'READ', error);
  }
};

export const httpRecordRecountLine = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const recountTaskId = String(req.params.taskId ?? '');
  const recountLineId = String(req.params.lineId ?? '');
  const { counted_quantity, count_method, scan_count } = req.body ?? {};

  if (!recountTaskId || !recountLineId) {
    return res.status(400).json({ error: 'taskId and lineId are required' });
  }

  if (!Number.isInteger(counted_quantity) || counted_quantity < 0) {
    return res.status(400).json({
      error: 'counted_quantity must be a non-negative integer',
    });
  }

  if (!['unit_scan', 'bin_quantity'].includes(count_method)) {
    return res.status(400).json({
      error: 'count_method must be unit_scan or bin_quantity',
    });
  }

  if (
    scan_count !== undefined &&
    scan_count !== null &&
    (!Number.isInteger(scan_count) || scan_count < 0)
  ) {
    return res.status(400).json({
      error: 'scan_count must be a non-negative integer',
    });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return recordCount(trx, {
        shopId,
        recountTaskId,
        recountLineId,
        countedQuantity: counted_quantity,
        countMethod: count_method,
        scanCount: scan_count,
        countedBy: userId,
      });
    });

    return res.status(200).json({
      recount_line_id: recountLineId,
      ...result,
    });
  } catch (error) {
    return respondRecountError(res, 'COUNT', error);
  }
};

export const httpCloseRecountTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const recountTaskId = String(req.params.taskId ?? '');
  if (!recountTaskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const closed = await closeCount(trx, shopId, recountTaskId, userId);

      await writeAuditLog(trx, {
        shopId,
        operatorId: userId,
        actionType: 'recount_close',
        entityType: 'recount_task',
        entityId: recountTaskId,
        metadata: closed,
      });

      return closed;
    });

    return res.status(200).json(result);
  } catch (error) {
    return respondRecountError(res, 'CLOSE', error);
  }
};

export const httpReviewRecountLine = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const recountTaskId = String(req.params.taskId ?? '');
  const recountLineId = String(req.params.lineId ?? '');
  const { decision, variance_reason, notes } = req.body ?? {};

  if (!recountTaskId || !recountLineId) {
    return res.status(400).json({ error: 'taskId and lineId are required' });
  }

  if (!['accept', 'recount', 'escalate'].includes(decision)) {
    return res.status(400).json({
      error: 'decision must be accept, recount, or escalate',
    });
  }

  const reasons = [
    'unrecorded_external_workflow',
    'shrinkage',
    'damage',
    'misplaced_stock',
    'count_error',
    'unknown',
  ];

  if (
    variance_reason !== undefined &&
    variance_reason !== null &&
    !reasons.includes(variance_reason)
  ) {
    return res.status(400).json({ error: 'variance_reason is invalid' });
  }

  if (decision === 'accept' && !variance_reason) {
    return res.status(400).json({
      error: 'variance_reason is required when decision=accept',
    });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      await reviewLine(trx, {
        shopId,
        recountTaskId,
        recountLineId,
        decision,
        varianceReason: variance_reason,
        notes,
        reviewedBy: userId,
      });

      await writeAuditLog(trx, {
        shopId,
        operatorId: userId,
        actionType: 'recount_line_review',
        entityType: 'recount_line',
        entityId: recountLineId,
        metadata: {
          recount_task_id: recountTaskId,
          decision,
          variance_reason: variance_reason ?? null,
        },
      });
    });

    return res.status(200).json({
      recount_line_id: recountLineId,
      reviewed: true,
    });
  } catch (error) {
    return respondRecountError(res, 'REVIEW', error);
  }
};

export const httpCommitRecountTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  const recountTaskId = String(req.params.taskId ?? '');
  if (!recountTaskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return commitRecount(trx, shopId, recountTaskId, userId);
    });

    return res.status(200).json(result);
  } catch (error) {
    return respondRecountError(res, 'COMMIT', error);
  }
};

/**
 * GET /api/v1/wms/recount-tasks?status=claimed,counting
 *
 * Privilege is derived from the JWT's shop_roles, not from a client flag —
 * an operator must not be able to request variance data by asking for it.
 */
export async function httpListRecountTasks(req: Request, res: Response) {
  try {
    const shopId = req.user?.shopId;
    const userId = req.user?.userId;
    const roles: string[] = req.user?.roles ?? [];

    if (!shopId || !userId) {
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }

    const privileged = roles.includes('owner') || roles.includes('admin');

    const statusParam = String(req.query.status ?? '').trim();
    const statuses = statusParam
      ? statusParam.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const tasks = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return listRecountTasks(trx, { shopId, userId, privileged, statuses });
    });

    return res.status(200).json({ tasks });
  } catch (error) {
    return respondRecountError(res, 'LIST', error);
  }
}