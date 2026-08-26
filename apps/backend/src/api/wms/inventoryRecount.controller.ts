// apps/backend/src/api/wms/inventoryRecount.controller.ts
import { Request, Response } from 'express';
import db, { withTenant } from '@lasyncro/backend-core/db.js';
import { getErrorMessage } from '@lasyncro/backend-core';
import { writeAuditLog } from '../../services/audit/operatorAudit.service.js';
import {
  createRecountTask,
  claimRecountTask,
  reassignRecountTask,
  getOperatorLines,
  recordCount,
  closeCount,
  reviewLine,
  commitRecount,
  listRecountTasks,
  skipLine,
  createRecountFinding,
  listRecountFindings,
  previewSuggestedBins,
  resolveDefaultWarehouseId,
  type RecountFindingType,
} from '../../services/wms/inventoryRecount.service.js';

/**
 * Inventory recount HTTP boundary.
 *
 * Counting never mutates stock. Only commitRecount() may write correction
 * movements after owner/admin review. Blind expected quantities remain enforced
 * by inventoryRecount.service.ts rather than trusting the client.
 */
// RECOUNT-CLOSE-HTTP-47: 'not yet resolved' is the current wording of the
// unresolved-lines rejection in closeCount(); it replaced 'not yet counted'
// under RECOUNT-COUNTZERO-34, when skip became a valid resolution. Both
// spellings are kept so older callers/messages still map to 409. If this
// message is ever reworded again, update this list in the same change --
// an unmatched business-state rejection silently degrades to HTTP 500.
function recountErrorStatus(message: string): number {
  if (message.toLowerCase().includes('not found')) return 404;

  if (
    message.includes('requires') ||
    message.includes('must be') ||
    message.includes('No lines match') ||
    // RECOUNT-CLAIM-ABANDONED-131: bad reassignment target — a validation
    // failure on caller-supplied input, not a task-state conflict.
    message.includes('not an active member') ||
    message.includes('does not have recount counting permission')
  ) {
    return 400;
  }

  if (
    message === 'PROBLEM_BIN_NOT_CONFIGURED' ||
    message.includes('already claimed') ||
    message.includes('already resolved') ||
    message.includes('client_event_id already used') ||
    message.includes('not claimable') ||
    message.includes('different operator') ||
    message.includes('not countable') ||
    message.includes('not closable') ||
    message.includes('not yet counted') || message.includes('not yet resolved') ||
    message.includes('not in review') ||
    message.includes('not committable') ||
    // RECOUNT-CLAIM-ABANDONED-131
    message.includes('not reassignable')
  ) {
    return 409;
  }

  return 500;
}

/**
 * RECOUNT-CLAIM-ABANDONED-131: a stable, machine-readable code for the one
 * case a stale open session needs to distinguish from every other 409 —
 * "this task's ownership changed out from under you" — without the frontend
 * substring-matching English error prose. Once a session is actively inside
 * a claimed/counting task, "owned by a different operator" can only mean a
 * reassignment happened (claim itself requires status='dispatched' and
 * claimed_by=null, so it can never produce this message for an
 * already-claimed task) — see inventoryRecount.service.ts's claim/count/
 * skip/close/finding gates.
 */
function recountErrorCode(message: string): string | undefined {
  if (message.includes('different operator')) return 'RECOUNT_OWNERSHIP_CHANGED';
  return undefined;
}

function respondRecountError(
  res: Response,
  operation: string,
  error: unknown,
) {
  const message = getErrorMessage(error);
  const status = recountErrorStatus(message);
  const code = status !== 500 ? recountErrorCode(message) : undefined;

  console.error(`[RECOUNT_${operation}_FAILED]`, { error: message });

  return res.status(status).json({
    error: status === 500
      ? `Inventory recount ${operation.toLowerCase()} failed: ${message}`
      : message,
    ...(code ? { code } : {}),
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
    location_codes,
    variant_ids,
    blind,
    notes,
  } = req.body ?? {};

  /**
   * RECOUNT-WAREHOUSE-31: optional. No WMS surface fetches warehouses, and
   * almost every laSyncro shop runs one — requiring it would mean building a
   * listing endpoint purely so the UI can look up a value it never chooses
   * between. Omitted resolves to warehouses.is_default (same fallback as
   * floor-planning.controller.ts:687). Multi-warehouse shops pass it
   * explicitly; a shop with no default gets a named 400, never a guess — a
   * count run against the wrong warehouse varies every line.
   */
  if (warehouse_id !== undefined && typeof warehouse_id !== 'string') {
    return res.status(400).json({ error: 'warehouse_id must be a string' });
  }

  const scopes = ['full', 'location', 'locations', 'variant_set', 'suggested'];
  if (!scopes.includes(scope)) {
    return res.status(400).json({
      error: 'scope must be full, location, locations, variant_set, or suggested',
    });
  }

  if (scope === 'location' && !location_code) {
    return res.status(400).json({
      error: 'location_code is required when scope=location',
    });
  }

  let normalizedLocationCodes: string[] | undefined;

  if (scope === 'locations') {
    if (!Array.isArray(location_codes) || location_codes.length === 0) {
      return res.status(400).json({
        error: 'location_codes must be a non-empty array when scope=locations',
      });
    }

    if (
      !location_codes.every(
        (code: unknown) => typeof code === 'string' && code.trim().length > 0
      )
    ) {
      return res.status(400).json({
        error: 'location_codes must contain only non-empty strings when scope=locations',
      });
    }

    normalizedLocationCodes = location_codes.map((code: string) => code.trim());

    if (new Set(normalizedLocationCodes).size !== normalizedLocationCodes.length) {
      return res.status(400).json({
        error: 'location_codes must contain unique values when scope=locations',
      });
    }
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
  if (blind === false) {
    return res.status(400).json({
      error: 'blind=false is not supported; recount tasks are always blind during counting',
    });
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
        locationCodes: normalizedLocationCodes,
        variantIds: variant_ids,
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

/**
 * RECOUNT-CLAIM-ABANDONED-131: owner/admin-only explicit recovery for an
 * abandoned claimed/counting task. requireAction('wms:recount:reassign')
 * (wms.routes.ts) already proves the ACTING caller is owner/admin before this
 * handler runs; reassignRecountTask (service) validates the TARGET.
 */
export const httpReassignRecountTask = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  /**
   * RECOUNT-CLAIM-ABANDONED-131: explicit, independent owner/admin guard —
   * NOT a substitute for requireAction('wms:recount:reassign') (wms.routes.ts),
   * an ADDITIONAL one. requireAction resolves through the shop-configurable
   * permission map (isActionAllowed / shop_role_permissions), which a shop
   * could misconfigure to grant 'operator' this action; this check reads the
   * trusted JWT shop_roles claim directly and cannot be overridden by shop
   * config, mirroring httpListRecountTasks's `privileged` computation (same
   * file) for the same reason: variance/ownership visibility must not be
   * gateable by a client-influenced permission row.
   */
  const roles: string[] = req.user?.roles ?? [];
  const isOwnerOrAdmin = roles.includes('owner') || roles.includes('admin');
  if (!isOwnerOrAdmin) {
    return res.status(403).json({ error: 'ACTION_FORBIDDEN', action: 'wms:recount:reassign' });
  }

  const recountTaskId = String(req.params.taskId ?? '');
  if (!recountTaskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  const targetUserId = Number(req.body?.target_user_id);
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
    return res.status(400).json({ error: 'target_user_id is required' });
  }

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return reassignRecountTask(trx, shopId, recountTaskId, userId, targetUserId);
    });

    return res.status(200).json({ task: result });
  } catch (error) {
    return respondRecountError(res, 'REASSIGN', error);
  }
};

export const httpPreviewSuggestedBins = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const requestedWarehouseId = String(
    req.query.warehouse_id ?? ''
  ).trim();

  try {
    const bins = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const warehouseId =
        requestedWarehouseId ||
        await resolveDefaultWarehouseId(trx, shopId);

      return previewSuggestedBins(trx, shopId, warehouseId);
    });

    return res.status(200).json({ bins });
  } catch (error) {
    return respondRecountError(res, 'READ', error);
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

    /**
     * RECOUNT-BLIND-39: `...result` spread recordCount's variance onto the
     * operator response, and expected = counted - variance. Blind counting is
     * server-enforced everywhere else on this surface (getOperatorLines
     * withholds expected_quantity; see the list-route note on not letting an
     * operator request variance by asking for it). Acknowledge the write only.
     */
    return res.status(200).json({
      recount_line_id: recountLineId,
      recorded: true,
    });
  } catch (error) {
    return respondRecountError(res, 'COUNT', error);
  }
};

const SKIP_REASONS = ['bin_inaccessible', 'stock_in_motion', 'bin_not_found', 'other'];

/**
 * RECOUNT-COUNTZERO-34: resolve a line the operator could not count.
 * Mirrors httpRecordRecountLine's tenant and error handling exactly — skip is
 * the same operator, same session, same permission (wms:recount:count).
 */
export const httpSkipRecountLine = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });
  const recountTaskId = String(req.params.taskId ?? '');
  const recountLineId = String(req.params.lineId ?? '');
  const { skip_reason, notes } = req.body ?? {};

  if (!recountTaskId || !recountLineId) {
    return res.status(400).json({ error: 'taskId and lineId are required' });
  }
  if (!SKIP_REASONS.includes(skip_reason)) {
    return res.status(400).json({ error: `skip_reason must be one of: ${SKIP_REASONS.join(', ')}` });
  }
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return res.status(400).json({ error: 'notes must be a string' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return skipLine(trx, {
        shopId, recountTaskId, recountLineId,
        skipReason: skip_reason, notes, skippedBy: userId,
      });
    });
    return res.status(200).json({ recount_line_id: recountLineId, skip_reason });
  } catch (error) {
    return respondRecountError(res, 'SKIP', error);
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

const RECOUNT_FINDING_TYPES: RecountFindingType[] = [
  'unexpected_item',
  'product_defect',
  'packaging_defect',
];

export async function httpCreateRecountFinding(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const recountTaskId = String(req.params.taskId ?? '');
  const {
    client_event_id,
    recount_line_id,
    lasyncro_variant_id,
    location_code,
    finding_type,
    quantity,
    notes,
  } = req.body ?? {};

  if (!recountTaskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  if (
    typeof lasyncro_variant_id !== 'string' ||
    !lasyncro_variant_id ||
    typeof location_code !== 'string' ||
    !location_code ||
    !RECOUNT_FINDING_TYPES.includes(finding_type)
  ) {
    return res.status(400).json({
      error:
        'lasyncro_variant_id, location_code, and a valid finding_type are required',
    });
  }

  if (
    typeof client_event_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      client_event_id
    )
  ) {
    return res.status(400).json({
      error: 'client_event_id must be a valid UUID',
    });
  }

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return res.status(400).json({
      error: 'quantity must be a positive whole number',
    });
  }

  if (
    recount_line_id !== undefined &&
    recount_line_id !== null &&
    typeof recount_line_id !== 'string'
  ) {
    return res.status(400).json({
      error: 'recount_line_id must be a string when provided',
    });
  }

  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    return res.status(400).json({
      error: 'notes must be a string when provided',
    });
  }

  try {
    const finding = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return createRecountFinding(trx, {
        shopId,
        recountTaskId,
        reportedBy: userId,
        finding: {
          clientEventId: client_event_id,
          recountLineId: recount_line_id ?? null,
          lasyncroVariantId: lasyncro_variant_id,
          locationCode: location_code,
          findingType: finding_type,
          quantity,
          notes,
        },
      });
    });

    return res.status(201).json({ finding });
  } catch (error) {
    return respondRecountError(res, 'FINDING', error);
  }
}

export async function httpListRecountFindings(req: Request, res: Response) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const recountTaskId = String(req.params.taskId ?? '');

  if (!recountTaskId) {
    return res.status(400).json({ error: 'taskId is required' });
  }

  try {
    const findings = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return listRecountFindings(trx, shopId, recountTaskId);
    });

    return res.status(200).json({ findings });
  } catch (error) {
    return respondRecountError(res, 'FINDING_LIST', error);
  }
}
