// apps/backend/src/api/suppliers/receiveJob.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import { createReceiveJob, inspectReceiveJobLine, closeReceiveJob } from '../../services/wms/receiveJob.service.js';
import { fireReceiveExceptionAlert } from '../../services/wms/wmsAlerts.service.js';

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
    const jobId = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const po = await trx('purchase_orders')
        .where({ id: poId, shop_id: shopId })
        .first();

      if (!po) return res.status(404).json({ error: 'Purchase order not found' });
      if (po.status !== 'shipped' && po.status !== 'partially_received') {
        return res.status(409).json({ error: `Cannot receive PO in status: ${po.status}` });
      }

      return createReceiveJob(trx, { shopId, poId, operatorId: req.user?.userId });
    });

    return res.status(201).json({ receive_job_id: jobId });
  } catch (err: any) {
    console.error('[RECEIVE_JOB_CREATE_FAILED]', { shopId, poId, error: err.message });
    return res.status(500).json({ error: `Failed to create receive job: ${err.message}` });
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

      const lines = await trx('receive_job_lines as rjl')
        .leftJoin('variants as v', 'rjl.lasyncro_variant_id', 'v.lasyncro_variant_id')
        .where({ 'rjl.receive_job_id': jobId, 'rjl.shop_id': shopId })
        .select(
          'rjl.*',
          'v.sku',
          'v.title as variant_title',
        );

      return { job, lines };
    });

    if (!result) return res.status(404).json({ error: 'Receive job not found' });
    return res.json(result);
  } catch (err: any) {
    console.error('[RECEIVE_JOB_GET_FAILED]', { shopId, jobId, error: err.message });
    return res.status(500).json({ error: 'Failed to fetch receive job' });
  }
}

// ─────────────────────────────────────────
// POST /receive-jobs/:jobId/inspect
// ─────────────────────────────────────────
export async function httpInspectReceiveJobLine(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const jobId = req.params.jobId as string;
  const { lasyncro_variant_id, quantity_accepted, quantity_rejected } = req.body;

  if (!lasyncro_variant_id || quantity_accepted == null || quantity_rejected == null) {
    return res.status(400).json({ error: 'lasyncro_variant_id, quantity_accepted, quantity_rejected required' });
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
        lasyncroVariantId: lasyncro_variant_id,
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
  const { lasyncro_variant_id, receive_job_line_id, exception_type, quantity_affected, notes } = req.body;

  if (!lasyncro_variant_id || !receive_job_line_id || !exception_type) {
    return res.status(400).json({ error: 'lasyncro_variant_id, receive_job_line_id, exception_type required' });
  }

  const VALID_TYPES = ['defect','packaging_damage','wrong_item','wrong_variant','wrong_quantity','barcode_mismatch','other'];
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
    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      await trx('receive_exceptions').insert({
        shop_id: shopId,
        receive_job_id: jobId,
        receive_job_line_id,
        lasyncro_variant_id,
        exception_type,
        quantity_affected: quantity_affected ?? 1,
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
    return res.status(201).json({ success: true });
  } catch (err: any) {
    console.error('[RECEIVE_EXCEPTION_FAILED]', { shopId, jobId, error: err.message });
    return res.status(500).json({ error: `Failed to report exception: ${err.message}` });
  }
}