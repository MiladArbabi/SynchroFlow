// apps/backend/src/api/suppliers/receiveJob.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import {
  createReceiveJob,
  inspectReceiveJobLine,
  closeReceiveJob,
  receiveLineReconciliationState,
  updateReceiveJobLineProgress,
} from '../../services/wms/receiveJob.service.js';
import { fireReceiveExceptionAlert } from '../../services/wms/wmsAlerts.service.js';
import { evaluateReceiveJobBarcodeReadiness } from '../../services/wms/receiveBarcodeReadiness.service.js';

/**
 * RECEIVE JOB CONTROLLER (FEAT-004)
 * -----------------------------------
 * Endpoints:
 * POST   /api/v1/suppliers/purchase-orders/:poId/receive-jobs         — create session
 * GET    /api/v1/suppliers/receive-jobs/:jobId                        — get job + lines
 * POST   /api/v1/suppliers/receive-jobs/:jobId/inspect                — inspect one line
 * POST   /api/v1/suppliers/receive-jobs/:jobId/close                  — close + create stow tasks
 */

// ─────────────────────────────────────────
// POST /purchase-orders/:poId/receive-jobs
// ─────────────────────────────────────────
export async function httpCreateReceiveJob(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const poId = req.params.poId as string;

  try {
    const { assigned_operator_id } = req.body ?? {};
    const jobId = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const po = await trx('purchase_orders')
        .where({ id: poId, shop_id: shopId })
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

      return createReceiveJob(trx, { shopId, poId, operatorId: assigned_operator_id ?? null });
    });

    return res.status(201).json({ receive_job_id: jobId });
  } catch (err: any) {
    if (err.statusCode === 404) return res.status(404).json({ error: err.message });
    if (err.statusCode === 409) return res.status(409).json({ error: err.message, receive_job_id: err.receive_job_id });
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
          'po.expected_delivery_date',
          trx.raw(`COALESCE(u.first_name || ' ' || COALESCE(u.last_name, ''), u.email) as operator_name`),
        )
        .orderBy('rj.created_at', 'desc');

      if (statusFilter) {
        query = query.whereIn('rj.status', statusFilter);
      }

      // Operators only see jobs assigned to them or unassigned (pool)
      if (roles.includes('operator') && !roles.includes('owner') && !roles.includes('admin')) {
        query = query.where(function () {
          this.whereNull('rj.assigned_operator_id')
            .orWhere('rj.assigned_operator_id', userId);
        });
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
          'po.expected_delivery_date',
          'po.actual_delivery_date',
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
        return {
          ...line,
          barcode_ready: lineReadiness?.ready ?? false,
          barcode_readiness_reason: lineReadiness?.reason ?? 'not_inspected',
          awaiting_label_ack: lineReadiness?.reason === 'labels_outstanding'
            || lineReadiness?.reason === 'unit_evidence_mismatch',
          accepted_unit_count: lineReadiness?.acceptedUnitCount ?? 0,
          labelled_unit_count: lineReadiness?.labelledUnitCount ?? 0,
          reported_problems: lineProblems,
          reconciliation,
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
  if (!shopId || !userId) return res.status(401).json({ error: 'Unauthorized' });
  const { jobId } = req.params;
  try {
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      const job = await trx('receive_jobs')
        .where({ receive_job_id: jobId, shop_id: shopId })
        .select('status', 'assigned_operator_id', 'started_at')
        .first();
      if (!job) throw Object.assign(new Error('JOB_NOT_FOUND'), { statusCode: 404 });
      if (!['pending', 'in_progress'].includes(job.status)) {
        throw Object.assign(new Error('JOB_NOT_CLAIMABLE'), { statusCode: 409 });
      }
      // Allow re-claim by same operator, reject if claimed by someone else
      if (job.assigned_operator_id && job.assigned_operator_id !== userId) {
        throw Object.assign(new Error('JOB_CLAIMED_BY_OTHER'), { statusCode: 409 });
      }
      await trx('receive_jobs')
        .where({ receive_job_id: jobId })
        .update({
          status: 'in_progress',
          assigned_operator_id: userId,
          started_at: job.started_at ?? new Date(),
          updated_at: new Date(),
        });
      console.info('[RECEIVE_JOB_CLAIMED]', { jobId, userId, shopId });
    });
    return res.json({ success: true, receive_job_id: jobId });
  } catch (err: any) {
    if (err.statusCode === 404) return res.status(404).json({ error: 'Job not found' });
    if (err.statusCode === 409) return res.status(409).json({ error: err.message });
    console.error('[RECEIVE_JOB_CLAIM_FAILED]', { jobId, userId, error: err.message });
    return res.status(500).json({ error: 'Failed to claim receive job' });
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
  const { quantity_sellable_provisional, reconciliation_required } = req.body ?? {};
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
    if (err.message.includes('not found')) return res.status(404).json({ error: err.message });
    if (err.message.includes('already inspected')) return res.status(409).json({ error: err.message });
    return res.status(500).json({ error: `Progress update failed: ${err.message}` });
  }
}

// ─────────────────────────────────────────
// POST /receive-jobs/:jobId/inspect
// ─────────────────────────────────────────
export async function httpInspectReceiveJobLine(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const jobId = req.params.jobId as string;
  const { lasyncro_variant_id, receive_job_line_id, quantity_accepted, quantity_rejected } = req.body;
  if (!lasyncro_variant_id && !receive_job_line_id) {
    return res.status(400).json({ error: 'lasyncro_variant_id or receive_job_line_id required' });
  }
  if (quantity_accepted == null || quantity_rejected == null) {
    return res.status(400).json({ error: 'quantity_accepted, quantity_rejected required' });
  }
  if (quantity_accepted < 0 || quantity_rejected < 0) {
    return res.status(400).json({ error: 'Quantities must be non-negative' });
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
        inspectedBy: req.user!.userId,
      });
    });

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[RECEIVE_JOB_INSPECT_FAILED]', { shopId, jobId, error: err.message });
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
  } = req.body;

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
      const { randomUUID } = await import('crypto');
      receiveExceptionId = randomUUID();
      await trx('receive_exceptions').insert({
        receive_exception_id: receiveExceptionId,
        shop_id: shopId,
        receive_job_id: jobId,
        receive_job_line_id,
        lasyncro_variant_id,
        exception_type,
        quantity_affected: quantity_affected ?? 1,
        accounting_role: accounting_role ?? (
          ['defect', 'wrong_item', 'wrong_variant', 'missing_item'].includes(exception_type)
            ? 'shortfall'
            : exception_type === 'extra_item'
              ? 'overage'
              : null
        ),
        counts_toward_shortfall: ['defect', 'wrong_item', 'wrong_variant', 'missing_item'].includes(exception_type)
          || (exception_type === 'other' && accounting_role === 'shortfall'),
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
    return res.status(500).json({ error: `Failed to report exception: ${err.message}` });
  }
}
