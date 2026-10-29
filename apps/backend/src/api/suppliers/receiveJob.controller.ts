// apps/backend/src/api/suppliers/receiveJob.controller.ts
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { ACTIVE_RECEIVE_STATUSES, lockReceiveJob, assertReceiveMutable, assertReceiveNotGroupFinalized, receiveError } from '../../services/wms/receiveWorkflowLock.service.js';

const validEventId = (value: unknown) => value === undefined || (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
import db from '@lasyncro/backend-core/db.js';
import {
  createReceiveJob,
  inspectReceiveJobLine,
  closeReceiveJob,
  confirmReceiveJobLineCount,
  receiveLineReconciliationState,
  recountReceiveJobLine,
  updateReceiveJobLineProgress,
} from '../../services/wms/receiveJob.service.js';
import { fireReceiveExceptionAlert } from '../../services/wms/wmsAlerts.service.js';
import { evaluateReceiveJobBarcodeReadiness } from '../../services/wms/receiveBarcodeReadiness.service.js';
import { resolveShopContextForUser } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import { isActionAllowed } from '../../services/permissions/permissionCache.service.js';

/**
 * RECEIVE JOB CONTROLLER (FEAT-004)
 * -----------------------------------
 * Endpoints:
 * POST   /api/v1/suppliers/purchase-orders/:poId/receive-jobs         — create session
 * GET    /api/v1/suppliers/receive-jobs/:jobId                        — get job + lines
 * POST   /api/v1/suppliers/receive-jobs/:jobId/inspect                — inspect one line
 * POST   /api/v1/suppliers/receive-jobs/:jobId/close                  — close + create stow tasks
 */

/** S4-3B / D1 — public refusal of recoverable-held capture until S4-4. */
const HELD_NOT_ENABLED = 'RECEIVE_RECOVERABLE_HELD_NOT_ENABLED';
const HELD_NOT_ENABLED_MESSAGE = `${HELD_NOT_ENABLED}: recoverable-held units cannot be captured until held custody and close are available`;

async function assertReceiveAssignee(
  shopId: number,
  dispatcherUserId: number,
  assignedOperatorId: unknown
): Promise<number> {
  if (
    assignedOperatorId == null ||
    !Number.isInteger(Number(assignedOperatorId)) ||
    Number(assignedOperatorId) <= 0
  ) {
    throw Object.assign(new Error('ASSIGNED_OPERATOR_REQUIRED'), {
      statusCode: 400,
    });
  }

  const userId = Number(assignedOperatorId);
  const context = await resolveShopContextForUser(userId);

  if (
    !context ||
    context.shopId !== shopId ||
    (
      context.role !== 'operator' &&
      userId !== dispatcherUserId
    )
  ) {
    throw Object.assign(new Error('INVALID_RECEIVE_ASSIGNEE'), {
      statusCode: 400,
    });
  }

  const receiveExecutionActions = [
    'receive-job:read',
    'receive-job:inspect',
    'receive-job:close',
    'receive-job:exception',
  ] as const;

  const permissionDecisions = await Promise.all(
    receiveExecutionActions.map((action) =>
      isActionAllowed(shopId, action, context.role)
    )
  );

  if (!permissionDecisions.every(Boolean)) {
    throw Object.assign(new Error('INVALID_RECEIVE_ASSIGNEE'), {
      statusCode: 400,
    });
  }

  return userId;
}

// ─────────────────────────────────────────
// POST /purchase-orders/:poId/receive-jobs
// ─────────────────────────────────────────
export async function httpCreateReceiveJob(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  const dispatcherUserId = req.user?.userId;
  if (!shopId || !dispatcherUserId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const poId = req.params.poId as string;

  try {
    const { assigned_operator_id } = req.body ?? {};
    const jobId = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      // Refusal-only hint: an in-flight close must not turn this create into
      // an unintended next delivery. Re-check again after the PO lock.
      const observedActive = await trx('receive_jobs').where({ shop_id: shopId, po_id: poId }).whereIn('status', ACTIVE_RECEIVE_STATUSES).first('receive_job_id');
      if (observedActive) throw Object.assign(receiveError('An active receive job already exists for this PO'), { receive_job_id: observedActive.receive_job_id });
      const po = await trx('purchase_orders')
        .where({ id: poId, shop_id: shopId }).forUpdate()
        .first();

      if (!po) throw Object.assign(new Error('Purchase order not found'), { statusCode: 404 });
      if (po.status !== 'shipped' && po.status !== 'partially_received') {
        throw Object.assign(new Error(`Cannot receive PO in status: ${po.status}`), { statusCode: 409 });
      }

      const activeJob = await trx('receive_jobs')
        .where({ po_id: poId, shop_id: shopId })
        .whereIn('status', ['pending', 'in_progress', 'inspection', 'barcode_assignment', 'stow_ready'])
        .first();

      if (activeJob) {
        throw Object.assign(
          new Error('An active receive job already exists for this PO'),
          { statusCode: 409, receive_job_id: activeJob.receive_job_id }
        );
      }

      const operatorId = await assertReceiveAssignee(
        shopId,
        dispatcherUserId,
        assigned_operator_id
      );

      return createReceiveJob(trx, { shopId, poId, operatorId });
    });

    return res.status(201).json({ receive_job_id: jobId });
  } catch (err: any) {
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    if (err.statusCode === 409) return res.status(409).json({ error: err.message, receive_job_id: err.receive_job_id });
    if (err.code === '23505') return res.status(409).json({ error: 'Receive creation conflict' });
    console.error('[RECEIVE_JOB_CREATE_FAILED]', { shopId, poId, error: err.message });
    return res.status(500).json({ error: `Failed to create receive job: ${err.message}` });
  }
}

// ─────────────────────────────────────────
// GET /receive-jobs
// ─────────────────────────────────────────
export async function httpListReceiveJobs(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;
  const roles = req.user?.roles ?? [];
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });

  // status filter: ?status=pending,in_progress (comma-separated, optional)
  const rawStatus = req.query.status as string | undefined;
  const statusFilter = rawStatus ? rawStatus.split(',').map((s) => s.trim()) : null;

  try {
    const jobs = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      let query = trx('receive_jobs as rj')
        .join('purchase_orders as po', 'rj.po_id', 'po.id')
        .join('suppliers as s', 'po.supplier_id', 's.id')
        .leftJoin('users as u', 'u.id', 'rj.assigned_operator_id')
        .where('rj.shop_id', shopId)
        .whereNot('rj.status', 'cancelled')
        .select(
          'rj.receive_job_id',
          'rj.status',
          'rj.assigned_operator_id',
          'rj.total_variants',
          'rj.total_units',
          'rj.units_accepted',
          'rj.units_rejected',
          'rj.units_inspected',
          'rj.started_at',
          'rj.closed_at',
          'rj.created_at',
          's.name as supplier_name',
          'po.id as po_id',
          'po.po_number',
          'po.expected_delivery_date',
          trx.raw(`COALESCE(u.first_name || ' ' || COALESCE(u.last_name, ''), u.email) as operator_name`),
        )
        .orderBy('rj.created_at', 'desc');

      if (statusFilter) {
        query = query.whereIn('rj.status', statusFilter);
      }

      // Operators only see jobs assigned to them. There is no operator-visible
      // unassigned Receive pool; dispatch assignment is required first.
      if (roles.includes('operator') && !roles.includes('owner') && !roles.includes('admin')) {
        query = query.where('rj.assigned_operator_id', userId);
      }

      return query;
    });

    return res.json({ receive_jobs: jobs });
  } catch (err: any) {
    console.error('[RECEIVE_JOB_LIST_FAILED]', { shopId, error: err.message });
    return res.status(500).json({ error: 'Failed to fetch receive jobs' });
  }
}

// ─────────────────────────────────────────
// GET /receive-jobs/:jobId
// ─────────────────────────────────────────
export async function httpGetReceiveJob(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const jobId = req.params.jobId as string;

  try {
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const job = await trx('receive_jobs as rj')
        .join('purchase_orders as po', 'rj.po_id', 'po.id')
        .join('suppliers as s', 'po.supplier_id', 's.id')
        .where({ 'rj.receive_job_id': jobId, 'rj.shop_id': shopId })
        .select(
          'rj.*',
          's.name as supplier_name',
          'po.po_number',
          'po.expected_delivery_date',
        )
        .first();

      if (!job) return null;

      const readiness = await evaluateReceiveJobBarcodeReadiness(trx, shopId, jobId);
      const readinessByLine = new Map(
        readiness.lines.map((line) => [line.receiveJobLineId, line])
      );

      const lines = await trx('receive_job_lines as rjl')
        .leftJoin('variants as v', 'rjl.lasyncro_variant_id', 'v.lasyncro_variant_id')
        .leftJoin('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .leftJoin('purchase_order_line_items as poli', 'rjl.po_line_item_id', 'poli.id')
        .where({ 'rjl.receive_job_id': jobId, 'rjl.shop_id': shopId })
        .select(
          'rjl.*',
          'v.sku',
          'v.title as variant_title',
          'v.image_url',
          'v.barcode',
          'p.title as product_title',
          'poli.description',
        );

      const reportedProblems = await trx('receive_exceptions')
        .where({ shop_id: shopId, receive_job_id: jobId })
        .whereNull('superseded_at')
        .select(
          'receive_exception_id',
          'receive_job_line_id',
          'exception_type',
          'quantity_affected',
          'notes',
          'resolved',
          'raised_at',
          'accounting_role',
          'counts_toward_shortfall',
        )
        .orderBy('raised_at', 'asc');

      const reportedProblemsByLine = new Map<string, any[]>();
      for (const problem of reportedProblems) {
        const lineProblems = reportedProblemsByLine.get(problem.receive_job_line_id) ?? [];
        lineProblems.push({
          receive_exception_id: problem.receive_exception_id,
          exception_type: problem.exception_type,
          quantity_affected: Number(problem.quantity_affected ?? 0),
          notes: problem.notes ?? null,
          resolved: Boolean(problem.resolved),
          raised_at: problem.raised_at,
          accounting_role: problem.accounting_role ?? null,
          counts_toward_shortfall: Boolean(problem.counts_toward_shortfall),
        });
        reportedProblemsByLine.set(problem.receive_job_line_id, lineProblems);
      }

      const linesWithReadiness = await Promise.all(lines.map(async (line: any) => {
        const lineReadiness = readinessByLine.get(line.receive_job_line_id);
        const lineProblems = reportedProblemsByLine.get(line.receive_job_line_id) ?? [];
        const provisionalSellable = line.inspection_complete
          ? Number(line.quantity_accepted ?? 0)
          : line.quantity_sellable_provisional != null
            ? Number(line.quantity_sellable_provisional)
            : Math.max(
            0,
            Number(line.quantity_expected ?? 0)
              - lineProblems
                .filter((problem) => problem.counts_toward_shortfall)
                .reduce((sum, problem) => sum + Number(problem.quantity_affected ?? 0), 0),
            );
        const reconciliation = await receiveLineReconciliationState(trx, {
          shopId,
          receiveJobId: jobId,
          receiveJobLineId: line.receive_job_line_id,
          expected: Number(line.quantity_expected ?? 0),
          sellable: provisionalSellable,
        });
        // GH-1241 S3-A1 — sellable for an untouched line is a projection
        // (expected − reported problems), never a count. Only the persisted
        // operator confirmation is physical-count evidence.
        const countConfirmed = line.quantity_count_confirmed != null;
        const countState = line.inspection_complete ? 'inspected' : countConfirmed ? 'confirmed' : 'not_counted';
        const sellableBasis = line.inspection_complete
          ? 'inspected'
          : line.quantity_sellable_provisional == null
            ? 'uncounted_projection'
            : countConfirmed && Number(line.quantity_count_confirmed) === Number(line.quantity_sellable_provisional)
              ? 'confirmed_count'
              : 'unconfirmed_draft';
        return {
          ...line,
          count_state: countState,
          barcode_ready: lineReadiness?.ready ?? false,
          barcode_readiness_reason: lineReadiness?.reason ?? 'not_inspected',
          awaiting_label_ack: lineReadiness?.reason === 'labels_outstanding'
            || lineReadiness?.reason === 'unit_evidence_mismatch'
            || lineReadiness?.reason === 'held_labels_outstanding'
            || lineReadiness?.reason === 'held_unit_evidence_mismatch',
          accepted_unit_count: lineReadiness?.acceptedUnitCount ?? 0,
          labelled_unit_count: lineReadiness?.labelledUnitCount ?? 0,
          reported_problems: lineProblems,
          reconciliation: { ...reconciliation, sellable_basis: sellableBasis },
        };
      }));

      return { job, lines: linesWithReadiness };
    });

    if (!result) return res.status(404).json({ error: 'Receive job not found' });
    return res.json(result);
  } catch (err: any) {
    console.error('[RECEIVE_JOB_GET_FAILED]', { shopId, jobId, error: err.message });
    return res.status(500).json({ error: 'Failed to fetch receive job' });
  }
}

// POST /receive-jobs/:jobId/claim
// Operator claims the receive job — sets status to in_progress, records started_at.
// Idempotent: re-claiming by same operator is allowed.
export async function httpClaimReceiveJob(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  const userId = req.user?.userId;

  if (!shopId || !userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { jobId } = req.params;

  try {
    await db.transaction(async (trx) => {
      await trx.raw(
        `SET LOCAL "app.current_tenant" = '${shopId}'`
      );

      // Atomic claim:
      // PostgreSQL re-checks this predicate after any row-lock wait. Claim can
      // only start work already assigned to this operator; it never assigns.
      const [claimed] = await trx('receive_jobs')
        .where({
          receive_job_id: jobId,
          shop_id: shopId,
        })
        .whereIn('status', ['pending', 'in_progress'])
        .andWhere('assigned_operator_id', userId)
        .update({
          status: 'in_progress',
          started_at: trx.raw(
            'COALESCE(started_at, NOW())'
          ),
          updated_at: new Date(),
        })
        .returning([
          'receive_job_id',
          'assigned_operator_id',
          'started_at',
        ]);

      if (claimed) {
        console.info('[RECEIVE_JOB_CLAIMED]', {
          jobId,
          userId,
          shopId,
        });
        return;
      }

      const job = await trx('receive_jobs')
        .where({
          receive_job_id: jobId,
          shop_id: shopId,
        })
        .first(
          'status',
          'assigned_operator_id',
          'started_at'
        );

      if (!job) {
        throw Object.assign(
          new Error('JOB_NOT_FOUND'),
          { statusCode: 404 }
        );
      }

      if (
        !['pending', 'in_progress'].includes(job.status)
      ) {
        throw Object.assign(
          new Error('JOB_NOT_CLAIMABLE'),
          { statusCode: 409 }
        );
      }

      if (
        !job.assigned_operator_id
      ) {
        throw Object.assign(
          new Error('JOB_NOT_ASSIGNED'),
          { statusCode: 409 }
        );
      }

      if (
        job.assigned_operator_id &&
        job.assigned_operator_id !== userId
      ) {
        throw Object.assign(
          new Error('JOB_CLAIMED_BY_OTHER'),
          { statusCode: 409 }
        );
      }

      throw Object.assign(
        new Error('JOB_CLAIM_CONFLICT'),
        { statusCode: 409 }
      );
    });

    return res.json({
      success: true,
      receive_job_id: jobId,
    });
  } catch (err: any) {
    if (err.statusCode === 404) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    if (err.statusCode === 409) {
      return res.status(409).json({
        error: err.message,
      });
    }

    console.error(
      '[RECEIVE_JOB_CLAIM_FAILED]',
      {
        jobId,
        userId,
        error: err.message,
      }
    );

    return res.status(500).json({
      error: 'Failed to claim receive job',
    });
  }
}

// PATCH /receive-jobs/:jobId/assignment
// Dispatcher recovery for pending, unstarted Receive work only.
export async function httpAssignReceiveJob(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  const dispatcherUserId = req.user?.userId;
  if (!shopId || !dispatcherUserId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const jobId = req.params.jobId as string;
  const { assigned_operator_id } = req.body ?? {};

  try {
    const job = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const operatorId = await assertReceiveAssignee(
        shopId,
        dispatcherUserId,
        assigned_operator_id
      );

      const current = await trx('receive_jobs')
        .where({
          shop_id: shopId,
          receive_job_id: jobId,
        })
        .first('receive_job_id', 'status', 'started_at', 'closed_at');

      if (!current) {
        throw Object.assign(new Error('JOB_NOT_FOUND'), {
          statusCode: 404,
        });
      }

      if (current.status !== 'pending' || current.started_at || current.closed_at) {
        throw Object.assign(new Error('JOB_NOT_REASSIGNABLE'), {
          statusCode: 409,
        });
      }

      const [updated] = await trx('receive_jobs')
        .where({
          shop_id: shopId,
          receive_job_id: jobId,
          status: 'pending',
        })
        .whereNull('started_at')
        .whereNull('closed_at')
        .update({
          assigned_operator_id: operatorId,
          updated_at: new Date(),
        })
        .returning([
          'receive_job_id',
          'status',
          'assigned_operator_id',
          'started_at',
        ]);

      // The row may have transitioned after the read above (for example, the
      // assigned operator claimed it concurrently). Never allow assignment to
      // overwrite ownership once execution has started.
      if (!updated) {
        throw Object.assign(new Error('JOB_NOT_REASSIGNABLE'), {
          statusCode: 409,
        });
      }

      return updated;
    });

    return res.json({ receive_job: job });
  } catch (err: any) {
    if (err.statusCode === 400) return res.status(400).json({ error: err.message });
    if (err.statusCode === 404) return res.status(404).json({ error: 'Job not found' });
    if (err.statusCode === 409) return res.status(409).json({ error: err.message });

    console.error('[RECEIVE_JOB_ASSIGNMENT_FAILED]', {
      shopId,
      jobId,
      error: err.message,
    });
    return res.status(500).json({ error: 'Failed to assign receive job' });
  }
}

// ─────────────────────────────────────────
// PATCH /receive-jobs/:jobId/lines/:lineId/progress
// ─────────────────────────────────────────
export async function httpUpdateReceiveJobLineProgress(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const jobId = req.params.jobId as string;
  const lineId = req.params.lineId as string;
  const { quantity_sellable_provisional, reconciliation_required, quantity_deferred } = req.body ?? {};
  if (!Number.isInteger(quantity_sellable_provisional) || quantity_sellable_provisional < 0) {
    return res.status(400).json({ error: 'quantity_sellable_provisional must be a non-negative integer' });
  }
  if (reconciliation_required != null && typeof reconciliation_required !== 'boolean') {
    return res.status(400).json({ error: 'reconciliation_required must be boolean when provided' });
  }

  try {
    const reconciliation = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return updateReceiveJobLineProgress(trx, {
        shopId,
        receiveJobId: jobId,
        receiveJobLineId: lineId,
        quantitySellableProvisional: quantity_sellable_provisional,
        reconciliationRequired: reconciliation_required === true,
        quantityDeferred: quantity_deferred,
      });
    });

    return res.json({
      success: true,
      receive_job_id: jobId,
      receive_job_line_id: lineId,
      quantity_sellable_provisional,
      reconciliation_required: reconciliation_required === true,
      reconciliation,
    });
  } catch (err: any) {
    console.error('[RECEIVE_JOB_PROGRESS_FAILED]', { shopId, jobId, lineId, error: err.message });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, ...(err.errorCode ? { code: err.errorCode } : {}) });
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    if (err.message.includes('already inspected')) return res.status(409).json({ error: err.message });
    return res.status(500).json({ error: `Progress update failed: ${err.message}` });
  }
}

// ─────────────────────────────────────────
// POST /receive-jobs/:jobId/lines/:lineId/confirm-count
// ─────────────────────────────────────────
/** GH-1241 S3-A1 — the operator's explicit physical count; inspection requires it. */
export async function httpConfirmReceiveJobLineCount(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const jobId = req.params.jobId as string;
  const lineId = req.params.lineId as string;
  const { quantity_confirmed, device_event_id } = req.body ?? {};
  if (!Number.isSafeInteger(quantity_confirmed) || quantity_confirmed < 0) {
    return res.status(400).json({ error: 'quantity_confirmed must be a non-negative integer', code: 'RECEIVE_COUNT_INVALID' });
  }
  if (device_event_id === undefined || !validEventId(device_event_id)) {
    return res.status(400).json({ error: 'A valid device_event_id is required', code: 'RECEIVE_COUNT_EVENT_REQUIRED' });
  }

  try {
    const confirmed = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return confirmReceiveJobLineCount(trx, {
        shopId,
        receiveJobId: jobId,
        receiveJobLineId: lineId,
        quantityConfirmed: quantity_confirmed,
        confirmationEventId: device_event_id,
        confirmedBy: req.user!.userId,
      });
    });

    return res.json({ success: true, receive_job_id: jobId, receive_job_line_id: lineId, ...confirmed });
  } catch (err: any) {
    console.error('[RECEIVE_JOB_CONFIRM_COUNT_FAILED]', { shopId, jobId, lineId, error: err.message });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, ...(err.errorCode ? { code: err.errorCode } : {}) });
    if (err.code === '23505') return res.status(409).json({ error: 'Count confirmation event conflicts with existing evidence', code: 'RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT' });
    return res.status(500).json({ error: `Count confirmation failed: ${err.message}` });
  }
}

// ─────────────────────────────────────────
// POST /receive-jobs/:jobId/lines/:lineId/recount
// ─────────────────────────────────────────
/** S8-C5 — supersede the line's shortfall allocations and void its count before inspection. */
export async function httpRecountReceiveJobLine(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const jobId = req.params.jobId as string;
  const lineId = req.params.lineId as string;
  const { device_event_id } = req.body ?? {};
  if (device_event_id === undefined || !validEventId(device_event_id)) {
    return res.status(400).json({ error: 'A valid device_event_id is required', code: 'RECEIVE_RECOUNT_EVENT_REQUIRED' });
  }

  try {
    const recounted = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return recountReceiveJobLine(trx, {
        shopId,
        receiveJobId: jobId,
        receiveJobLineId: lineId,
        recountEventId: device_event_id,
        recountedBy: req.user!.userId,
      });
    });

    return res.json({ success: true, receive_job_id: jobId, receive_job_line_id: lineId, ...recounted });
  } catch (err: any) {
    console.error('[RECEIVE_JOB_RECOUNT_FAILED]', { shopId, jobId, lineId, error: err.message });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, ...(err.errorCode ? { code: err.errorCode } : {}) });
    if (err.code === '23505') return res.status(409).json({ error: 'Recount event conflicts with existing evidence', code: 'RECEIVE_RECOUNT_REPLAY_CONFLICT' });
    return res.status(500).json({ error: `Recount failed: ${err.message}` });
  }
}

// ─────────────────────────────────────────
// POST /receive-jobs/:jobId/inspect
// ─────────────────────────────────────────
export async function httpInspectReceiveJobLine(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const jobId = req.params.jobId as string;
  const { lasyncro_variant_id, receive_job_line_id, quantity_accepted, quantity_rejected, quantity_missing, quantity_deferred, quantity_held_recoverable, device_event_id } = req.body;
  if (!validEventId(device_event_id)) return res.status(400).json({ error: 'Invalid device_event_id' });
  if (!lasyncro_variant_id && !receive_job_line_id) {
    return res.status(400).json({ error: 'lasyncro_variant_id or receive_job_line_id required' });
  }
  if (quantity_accepted == null || quantity_rejected == null) {
    return res.status(400).json({ error: 'quantity_accepted, quantity_rejected required' });
  }
  if (!Number.isSafeInteger(quantity_accepted) || !Number.isSafeInteger(quantity_rejected) || quantity_accepted < 0 || quantity_rejected < 0) {
    return res.status(400).json({ error: 'Quantities must be non-negative' });
  }
  // S4-3B / D1: held capture exists only at the service layer until S4-4
  // brings custody and close; refused here before any transaction.
  if (quantity_held_recoverable != null && quantity_held_recoverable !== 0) {
    return res.status(409).json({ error: HELD_NOT_ENABLED_MESSAGE, code: HELD_NOT_ENABLED });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await inspectReceiveJobLine(trx, {
        shopId,
        receiveJobId: jobId,
        lasyncroVariantId: lasyncro_variant_id ?? null,
        receiveJobLineId: receive_job_line_id ?? null,
        quantityAccepted: quantity_accepted,
        quantityRejected: quantity_rejected,
        quantityMissing: quantity_missing,
        quantityDeferred: quantity_deferred,
        quantityHeldRecoverable: quantity_held_recoverable,
        deviceEventId: device_event_id,
        requireExplicitDisposition: true,
        inspectedBy: req.user!.userId,
      });
    });

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[RECEIVE_JOB_INSPECT_FAILED]', { shopId, jobId, error: err.message });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, ...(err.errorCode ? { code: err.errorCode } : {}) });
    if (err.code === '23505') return res.status(409).json({ error: 'Inspection event conflicts with existing evidence' });
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    if (err.message.includes('already inspected')) return res.status(409).json({ error: err.message });
    return res.status(500).json({ error: `Inspection failed: ${err.message}` });
  }
}

// ─────────────────────────────────────────
// POST /receive-jobs/:jobId/close
// ─────────────────────────────────────────
export async function httpCloseReceiveJob(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const jobId = req.params.jobId as string;
  const { actual_delivery_date } = req.body;
  if (typeof actual_delivery_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(actual_delivery_date) || Number.isNaN(Date.parse(actual_delivery_date)) || new Date(actual_delivery_date).toISOString().slice(0, 10) !== actual_delivery_date) {
    return res.status(400).json({ error: 'A valid actual_delivery_date is required' });
  }

  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      await closeReceiveJob(trx, {
        shopId,
        receiveJobId: jobId,
        actualDeliveryDate: actual_delivery_date,
        closedBy: req.user!.userId,
      });
    });

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[RECEIVE_JOB_CLOSE_FAILED]', { shopId, jobId, error: err.message });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, ...(err.errorCode ? { code: err.errorCode } : {}) });
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    if (err.message.includes('Already closed')) return res.status(409).json({ error: err.message });
    if (err.message.includes('not yet inspected')) return res.status(409).json({ error: err.message });
    return res.status(500).json({ error: `Failed to close receive job: ${err.message}` });
  }
}

// ─────────────────────────────────────────
// POST /receive-jobs/:jobId/exception
// ─────────────────────────────────────────
export async function httpReportReceiveException(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const jobId = req.params.jobId as string;
  const {
    lasyncro_variant_id,
    receive_job_line_id,
    exception_type,
    quantity_affected,
    notes,
    accounting_role,
    device_event_id,
    disposition,
  } = req.body;
  // S4-3B / D1: no recoverable-held evidence through the public API until S4-4.
  if (disposition === 'recoverable_held') {
    return res.status(409).json({ error: HELD_NOT_ENABLED_MESSAGE, code: HELD_NOT_ENABLED });
  }
  const affected = quantity_affected ?? 1;
  if (!Number.isSafeInteger(affected) || affected <= 0 || !validEventId(device_event_id)) return res.status(400).json({ error: 'Positive integer quantity and valid device_event_id required' });
  if (accounting_role != null && !['shortfall', 'overage'].includes(accounting_role)) return res.status(400).json({ error: 'Invalid accounting_role' });
  if (accounting_role === 'overage' && exception_type !== 'extra_item') return res.status(400).json({ error: 'Only extra_item can approve overage' });
  if (['extra_item', 'barcode_mismatch'].includes(exception_type) && accounting_role === 'shortfall') return res.status(400).json({ error: 'This exception cannot account for shortfall' });

  if (!lasyncro_variant_id || !receive_job_line_id || !exception_type) {
    return res.status(400).json({ error: 'lasyncro_variant_id, receive_job_line_id, exception_type required' });
  }

  const VALID_TYPES = ['defect','packaging_damage','wrong_item','wrong_variant','wrong_quantity','missing_item','extra_item','barcode_mismatch','other'];
  if (!VALID_TYPES.includes(exception_type)) {
    return res.status(400).json({ error: `Invalid exception_type. Must be one of: ${VALID_TYPES.join(', ')}` });
  }
  if (exception_type === 'other' && !notes) {
    return res.status(400).json({ error: 'notes required when exception_type is other' });
  }
  if (exception_type === 'barcode_mismatch' && !notes) {
    return res.status(400).json({ error: 'notes required for barcode_mismatch — capture the scanned value' });
  }

  try {
    let receiveExceptionId: string | null = null;
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const { job } = await lockReceiveJob(trx, shopId, jobId);
      const line = await trx('receive_job_lines').where({ shop_id: shopId, receive_job_id: jobId, receive_job_line_id }).forUpdate().first();
      if (!line) throw receiveError('Receive line not found', 404);
      if (line.lasyncro_variant_id !== lasyncro_variant_id) throw receiveError('Receive line variant mismatch', 400);
      const role = accounting_role ?? (['defect', 'wrong_item', 'wrong_variant', 'missing_item'].includes(exception_type) ? 'shortfall' : null);
      if (device_event_id) {
        const original = await trx('receive_exceptions').where({ shop_id: shopId, device_event_id }).first();
        if (original) {
          if (original.receive_job_id !== jobId || original.receive_job_line_id !== receive_job_line_id
            || original.lasyncro_variant_id !== lasyncro_variant_id || original.exception_type !== exception_type
            || Number(original.quantity_affected) !== affected || original.accounting_role !== role || original.notes !== (notes ?? null)) {
            throw receiveError('Exception replay differs from original evidence');
          }
          receiveExceptionId = original.receive_exception_id;
          return;
        }
      }
      assertReceiveMutable(job);
      // GH-1241 S3-B: a grouped finalization's accounting is immutable.
      if (role !== null || exception_type === 'other') await assertReceiveNotGroupFinalized(trx, shopId, jobId);
      // After final inspection only non-accounting incidents may be reported:
      // no shortfall/overage role, and not 'other' (which the reconciliation
      // projection counts toward shortfall). Inspected quantities never change.
      if (line.inspection_complete && (role !== null || exception_type === 'other')) {
        throw receiveError('Cannot add accounting exceptions after final inspection');
      }
      receiveExceptionId = randomUUID();
      await trx('receive_exceptions').insert({
        receive_exception_id: receiveExceptionId,
        shop_id: shopId,
        receive_job_id: jobId,
        receive_job_line_id,
        lasyncro_variant_id,
        exception_type,
        quantity_affected: affected,
        device_event_id: device_event_id ?? null,
        // GH-1108 AUDIT CORRECTION — exception_type='extra_item' must NOT
        // imply accounting_role='overage' by default. Overage approval is
        // the explicit evidence "Accept extra" persists (accounting_role
        // sent explicitly); "Report problem" reports an extra_item without
        // ever sending accounting_role and must not silently become
        // approval. Only the shortfall types keep an inferred default —
        // reconciliation accounting depends on it and those types have no
        // "approval" meaning to accidentally grant.
        accounting_role: accounting_role ?? (
          ['defect', 'wrong_item', 'wrong_variant', 'missing_item'].includes(exception_type)
            ? 'shortfall'
            : null
        ),
        counts_toward_shortfall: role === 'shortfall',
        notes: notes ?? null,
        raised_by: req.user!.userId,
        raised_at: new Date(),
      });
      await fireReceiveExceptionAlert(trx, {
        shopId,
        receiveJobId: jobId,
        lasyncroVariantId: lasyncro_variant_id,
        exceptionType: exception_type,
      });
    });
    console.info('[RECEIVE_EXCEPTION_REPORTED]', { shopId, jobId, exception_type, lasyncro_variant_id });
    return res.status(201).json({ success: true, receive_exception_id: receiveExceptionId });
  } catch (err: any) {
    console.error('[RECEIVE_EXCEPTION_FAILED]', { shopId, jobId, error: err.message });
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message, ...(err.errorCode ? { code: err.errorCode } : {}) });
    if (err.code === '23505') return res.status(409).json({ error: 'Exception event conflicts with existing evidence' });
    return res.status(500).json({ error: `Failed to report exception: ${err.message}` });
  }
}
