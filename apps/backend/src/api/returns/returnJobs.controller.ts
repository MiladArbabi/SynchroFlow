// apps/backend/src/api/returns/returnJobs.controller.ts
//
// RETURN JOBS CONTROLLER
// ----------------------
// HTTP handlers for the return job lifecycle.
//
// Routes (added to returns.routes.ts):
//   GET    /api/v1/modules/returns/jobs              — list open jobs (mobile + web)
//   POST   /api/v1/modules/returns/jobs              — create job (operator, mobile)
//   POST   /api/v1/modules/returns/jobs/:id/claim    — claim job (operator/owner/admin, web+mobile — WEB-RETURN-01)
//   PATCH  /api/v1/modules/returns/jobs/:id/lines/:lineId — set conditionon line item
//   POST   /api/v1/modules/returns/jobs/:id/complete — complete job (operator)
//   GET    /api/v1/modules/returns/items             — items awaiting owner decision (web)
//   PATCH  /api/v1/modules/returns/items/:id/decision — owner sets decision (web)

import { Request, Response } from 'express';
import {
  createCustomerReturnJob,
  createUndeliveredReturnJob,
  processReturnLine,
  completeReturnJob,
  setOwnerDecision,
  listReturnJobs,
  listItemsAwaitingDecision,
  type UndeliveredReason,
  type OwnerDecision,
  type ItemCondition,
  claimReturnJob,
  getReturnJob,
  CustomerReturnReason,
  createManualReturnLine,
  setLineOwnerDecision,
} from '../../services/returns/returnJobs.service.js';

const VALID_ITEM_CONDITIONS: ItemCondition[] = ['resellable', 'repackable', 'damaged', 'unsellable'];
const VALID_UNDELIVERED_REASONS: UndeliveredReason[] = ['wrong_address', 'not_claimed', 'customs', 'carrier_error', 'other'];
const VALID_RETURN_REASONS: CustomerReturnReason[] = ['wrong_item', 'damaged_in_transit', 'damaged_on_arrival', 'not_as_described', 'quality_issue', 'changed_mind', 'duplicate_order', 'other'];
const VALID_OWNER_DECISIONS: OwnerDecision[] = ['reship', 'contact_customer', 'initiate_refund', 'write_off'];

// ─── GET /jobs ────────────────────────────────────────────────────────────────
export const httpListReturnJobs = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const jobs = await listReturnJobs(shopId);
    return res.status(200).json({ data: jobs });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[RETURN_JOBS_LIST_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to list return jobs: ${message}` });
  }
};

// ─── GET /jobs/:id ───────────────────────────────────────────────────────────────

export const httpGetReturnJob = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  const returnJobId = req.params.id as string;

  try {
    const job = await getReturnJob(shopId, returnJobId);
    if (!job) return res.status(404).json({ error: 'Return job not found' });
    return res.status(200).json({ data: job });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[RETURN_JOB_GET_FAILED]', { shopId, returnJobId, error: message });
    return res.status(500).json({ error: `Failed to fetch return job: ${message}` });
  }
};

// ─── POST /jobs/:id/claim ───────────────────────────────────────────────────────

export const httpClaimReturnJob = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const operatorId = req.user?.userId;
  if (!shopId || !operatorId) return res.status(401).json({ error: 'Unauthorized' });

  const returnJobId = req.params.id as string;

  try {
    await claimReturnJob({ shopId, returnJobId, operatorId });
    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[RETURN_JOB_CLAIM_FAILED]', { shopId, returnJobId, error: message });
    if (message.includes('not found')) return res.status(404).json({ error: message });
    if (message.includes('not claimable') || message.includes('already claimed')) return res.status(409).json({ error: message });
    return res.status(500).json({ error: `Failed to claim return job: ${message}` });
  }
};

// ─── POST /jobs ───────────────────────────────────────────────────────────────

export const httpCreateReturnJob = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const operatorId = req.user?.userId;
  if (!shopId || !operatorId) return res.status(401).json({ error: 'Unauthorized' });
  
  const { origin, lasyncro_refund_execution_id, lasyncro_order_id, undelivered_reason, return_reason, return_notes, notes } = req.body;
  if (!origin || !lasyncro_order_id) {
    return res.status(400).json({ error: 'origin and lasyncro_order_id are required' });
  }

  try {
    let returnJobId: string;

    if (origin === 'customer_return') {
      if (!lasyncro_refund_execution_id) {
        return res.status(400).json({ error: 'lasyncro_refund_execution_id required for customer_return' });
      }
      if (!return_reason || !VALID_RETURN_REASONS.includes(return_reason)) {
        return res.status(400).json({
          error: `return_reason required for customer_return. Valid values: ${VALID_RETURN_REASONS.join(', ')}`,
        });
      }
      if (return_reason === 'other' && !return_notes) {
        return res.status(400).json({ error: 'return_notes required when return_reason is "other"' });
      }
      returnJobId = await createCustomerReturnJob({
        shopId,
        lasyncroRefundExecutionId: lasyncro_refund_execution_id,
        lasyncroOrderId: lasyncro_order_id,
        operatorId,
        notes,
        returnReason: return_reason,
        returnNotes: return_notes,
      });
      
    } else if (origin === 'undelivered_return') {
      if (!undelivered_reason || !VALID_UNDELIVERED_REASONS.includes(undelivered_reason)) {
        return res.status(400).json({
          error: `undelivered_reason required for undelivered_return. Valid values: ${VALID_UNDELIVERED_REASONS.join(', ')}`,
        });
      }
      returnJobId = await createUndeliveredReturnJob({
        shopId,
        lasyncroOrderId: lasyncro_order_id,
        undeliveredReason: undelivered_reason,
        operatorId,
        notes,
      });
    } else {
      return res.status(400).json({ error: 'origin must be customer_return or undelivered_return' });
    }

    return res.status(201).json({ return_job_id: returnJobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[RETURN_JOB_CREATE_FAILED]', { shopId, origin, error: message });
    // Surface duplicate undelivered job as 409
    if (message.includes('already exists')) return res.status(409).json({ error: message });
    return res.status(500).json({ error: `Failed to create return job: ${message}` });
  }
};

// ─── PATCH /jobs/:id/lines/:lineId ────────────────────────────────────────────

export const httpProcessReturnLine = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const operatorId = req.user?.userId;
  if (!shopId || !operatorId) return res.status(401).json({ error: 'Unauthorized' });

  const returnJobId = req.params.id as string;
  const refundLineItemId = req.params.lineId as string;
  const { item_condition, quantity_received, condition_notes } = req.body;

  if (!item_condition || !VALID_ITEM_CONDITIONS.includes(item_condition)) {
    return res.status(400).json({
      error: `item_condition required. Valid values: ${VALID_ITEM_CONDITIONS.join(', ')}`,
    });
  }
  if (quantity_received == null || quantity_received < 0) {
    return res.status(400).json({ error: 'quantity_received must be a non-negative integer' });
  }

  try {
    await processReturnLine({
      shopId,
      returnJobId,
      refundLineItemId,
      itemCondition: item_condition,
      quantityReceived: quantity_received,
      conditionNotes: condition_notes,
      operatorId,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[RETURN_LINE_PROCESS_FAILED]', { shopId, returnJobId, refundLineItemId, error: message });
    if (message.includes('not found')) return res.status(404).json({ error: message });
    if (message.includes('not processable')) return res.status(409).json({ error: message });
    return res.status(500).json({ error: `Failed to process return line: ${message}` });
  }
};

// ─── POST /jobs/:id/lines (manual line add — scan_intake, pre-refund) ────────
export const httpAddManualReturnLine = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const operatorId = req.user?.userId;
  if (!shopId || !operatorId) return res.status(401).json({ error: 'Unauthorized' });

  const returnJobId = req.params.id as string;
  const { scanned_value, quantity_received, item_condition, condition_notes } = req.body;

  if (!scanned_value) return res.status(400).json({ error: 'scanned_value required' });
  if (!quantity_received || quantity_received < 1) return res.status(400).json({ error: 'quantity_received must be at least 1' });
  if (!item_condition || !VALID_ITEM_CONDITIONS.includes(item_condition)) {
    return res.status(400).json({
      error: `item_condition required. Valid values: ${VALID_ITEM_CONDITIONS.join(', ')}`,
    });
  }
  if ((item_condition === 'damaged' || item_condition === 'unsellable') && !condition_notes) {
    return res.status(400).json({ error: 'condition_notes required when item_condition is damaged or unsellable' });
  }

  try {
    const lineId = await createManualReturnLine({
      shopId,
      returnJobId,
      scannedValue: scanned_value,
      quantityReceived: quantity_received,
      itemCondition: item_condition,
      conditionNotes: condition_notes,
      operatorId,
    });
    return res.status(201).json({ lasyncro_refund_line_item_id: lineId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[RETURN_LINE_MANUAL_ADD_FAILED]', { shopId, returnJobId, error: message });
    if (message.includes('not recognised') || message.includes('not found') || message.includes('No matching order line')) {
      return res.status(404).json({ error: message });
    }
    if (message.includes('not processable')) {
      return res.status(409).json({ error: message });
    }
    return res.status(500).json({ error: `Failed to add return line: ${message}` });
  }
};

// ─── POST /jobs/:id/complete ──────────────────────────────────────────────────
export const httpCompleteReturnJob = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const operatorId = req.user?.userId;
  if (!shopId || !operatorId) return res.status(401).json({ error: 'Unauthorized' });

  const returnJobId = req.params.id as string;
  const { return_reason, return_notes } = req.body;

  if (return_reason && !VALID_RETURN_REASONS.includes(return_reason)) {
    return res.status(400).json({
      error: `Invalid return_reason. Valid values: ${VALID_RETURN_REASONS.join(', ')}`,
    });
  }
  if (return_reason === 'other' && !return_notes) {
    return res.status(400).json({ error: 'return_notes required when return_reason is "other"' });
  }

  try {
    await completeReturnJob({ shopId, returnJobId, operatorId, returnReason: return_reason, returnNotes: return_notes });
    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[RETURN_JOB_COMPLETE_FAILED]', { shopId, returnJobId, error: message });
    if (message.includes('not found')) return res.status(404).json({ error: message });
    if (message.includes('awaiting owner decision')) return res.status(409).json({ error: message });
    if (message.includes('return_reason required')) return res.status(400).json({ error: message });
    return res.status(500).json({ error: `Failed to complete return job: ${message}` });
  }
};

// ─── GET /items ───────────────────────────────────────────────────────────────

export const httpListItemsAwaitingDecision = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const items = await listItemsAwaitingDecision(shopId);
    return res.status(200).json({ data: items });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[RETURN_ITEMS_LIST_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: `Failed to list items awaiting decision: ${message}` });
  }
};

// ─── PATCH /items/:id/decision ────────────────────────────────────────────────
// :id is the LINE ITEM id (lasyncro_refund_line_item_id), not the job id —
// decisions are per-line as of the multi-line rework (2026-07-07).
export const httpSetOwnerDecision = async (req: Request, res: Response) => {
  const shopId = req.user?.shopId;
  const decidedBy = req.user?.userId;
  if (!shopId || !decidedBy) return res.status(401).json({ error: 'Unauthorized' });

  const lineItemId = req.params.id as string;
  const { decision, decision_notes } = req.body;

  if (!decision || !VALID_OWNER_DECISIONS.includes(decision)) {
    return res.status(400).json({
      error: `decision required. Valid values: ${VALID_OWNER_DECISIONS.join(', ')}`,
    });
  }

  try {
    await setLineOwnerDecision({
      shopId,
      lineItemId,
      decision,
      decisionNotes: decision_notes,
      decidedBy,
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[RETURN_LINE_DECISION_FAILED]', { shopId, lineItemId, decision, error: message });
    if (message.includes('not found')) return res.status(404).json({ error: message });
    if (message.includes('does not require a decision')) return res.status(409).json({ error: message });
    return res.status(500).json({ error: `Failed to set decision: ${message}` });
  }
};