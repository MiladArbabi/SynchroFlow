// apps/backend/src/api/suppliers/receiveReconciliation.controller.ts
import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';
import {
  finalizeReconciliation,
  isEventId,
  parseGroupedLines,
  readReconciliation,
  saveReconciliationDraft,
} from '../../services/wms/receiveReconciliation.service.js';

/**
 * GROUPED RECEIVE RECONCILIATION (GH-1241 S3-B)
 * GET  /api/v1/suppliers/receive-jobs/:jobId/reconciliation           — revisions, active lines, finalization
 * PUT  /api/v1/suppliers/receive-jobs/:jobId/reconciliation/draft     — append a superseding draft revision
 * POST /api/v1/suppliers/receive-jobs/:jobId/reconciliation/finalize  — finalize the current revision atomically
 * Every refusal is machine-readable: { error, code }.
 */

function refuse(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: `${code}: ${message}`, code });
}

function respondError(res: Response, err: any, label: string, context: Record<string, unknown>) {
  console.error(label, { ...context, error: err?.message });
  if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message, ...(err.errorCode ? { code: err.errorCode } : {}) });
  if (err?.code === '23505') {
    return refuse(res, 409, 'RECEIVE_RECONCILIATION_REPLAY_CONFLICT', 'this reconciliation event or revision conflicts with existing evidence');
  }
  return res.status(500).json({ error: 'RECEIVE_RECONCILIATION_FAILED', code: 'RECEIVE_RECONCILIATION_FAILED' });
}

export async function httpGetReceiveReconciliation(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  const jobId = req.params.jobId as string;
  if (!isEventId(jobId)) return refuse(res, 404, 'RECEIVE_JOB_NOT_FOUND', 'Receive job not found');

  try {
    const view = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return readReconciliation(trx, shopId, jobId);
    });
    return res.json(view);
  } catch (err: any) {
    return respondError(res, err, '[RECEIVE_RECONCILIATION_READ_FAILED]', { shopId, jobId });
  }
}

export async function httpSaveReceiveReconciliationDraft(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  const jobId = req.params.jobId as string;
  const { base_revision_id, device_event_id, lines } = req.body ?? {};
  if (!isEventId(device_event_id)) return refuse(res, 400, 'RECEIVE_RECONCILIATION_EVENT_REQUIRED', 'a valid device_event_id is required');
  if (base_revision_id != null && !isEventId(base_revision_id)) {
    return refuse(res, 400, 'RECEIVE_RECONCILIATION_REVISION_INVALID', 'base_revision_id must be a UUID or null');
  }

  try {
    const parsed = parseGroupedLines(lines);
    const revision = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return saveReconciliationDraft(trx, {
        shopId,
        receiveJobId: jobId,
        baseRevisionId: base_revision_id ?? null,
        deviceEventId: device_event_id.toLowerCase(),
        lines: parsed,
        actorId: req.user!.userId,
      });
    });
    return res.status(200).json({ ...revision, status: 'current' });
  } catch (err: any) {
    return respondError(res, err, '[RECEIVE_RECONCILIATION_DRAFT_FAILED]', { shopId, jobId });
  }
}

export async function httpFinalizeReceiveReconciliation(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  const jobId = req.params.jobId as string;
  const { current_revision_id, device_event_id, lines } = req.body ?? {};
  if (!isEventId(device_event_id)) return refuse(res, 400, 'RECEIVE_RECONCILIATION_EVENT_REQUIRED', 'a valid device_event_id is required');
  if (!isEventId(current_revision_id)) {
    return refuse(res, 409, 'RECEIVE_RECONCILIATION_REVISION_REQUIRED', 'current_revision_id of the current draft revision is required');
  }

  try {
    const parsed = parseGroupedLines(lines);
    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
      return finalizeReconciliation(trx, {
        shopId,
        receiveJobId: jobId,
        currentRevisionId: current_revision_id,
        deviceEventId: device_event_id.toLowerCase(),
        lines: parsed,
        actorId: req.user!.userId,
      });
    });
    return res.json(result);
  } catch (err: any) {
    return respondError(res, err, '[RECEIVE_RECONCILIATION_FINALIZE_FAILED]', { shopId, jobId });
  }
}
