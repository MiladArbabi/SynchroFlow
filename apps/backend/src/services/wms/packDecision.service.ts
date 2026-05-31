// apps/backend/src/services/wms/packDecision.service.ts
import { Knex } from 'knex';
import { firePickExceptionAlert } from './wmsAlerts.service.js';
import { dispatchNotification } from '../notifications/notificationDispatch.service.js';

/**
 * PACK DECISION SERVICE
 * ----------------------
 * Handles blocking decisions during pack/ship for item_missing
 * and short_pick exceptions that require owner/admin approval.
 *
 * Lifecycle:
 *   Operator raises request → pack job pauses on that order
 *   Owner notified (push + Alert: warehouse_floor, owner)
 *   Owner approves (partial_shipment=true|false) or rejects (requeue)
 *   Packer polls GET until status !== pending
 *
 * Invariants:
 *   - One pending request per (shop_id, pick_batch_id, lasyncro_order_id,
 *     lasyncro_line_item_id) — unique constraint enforced in DB
 *   - Only owner/admin can resolve (enforced at controller layer)
 *   - partial_shipment only set on approval
 */

export type PackDecisionQuestion = 'ship_partial' | 'hold_and_requeue';
export type PackDecisionStatus   = 'pending' | 'approved' | 'rejected';

export interface RaisePackDecisionInput {
  shopId: number;
  pickBatchId: string;
  lasyncroOrderId: string;
  lasyncroLineItemId: string;
  exceptionType: 'item_missing' | 'short_pick';
  question: PackDecisionQuestion;
  raisedBy: number;
}

export interface ResolvePackDecisionInput {
  requestId: string;
  shopId: number;
  resolvedBy: number;
  status: 'approved' | 'rejected';
  partialShipment?: boolean;
  note?: string;
}

export interface PackDecisionRequest {
  id: string;
  shop_id: number;
  pick_batch_id: string;
  lasyncro_order_id: string;
  lasyncro_line_item_id: string;
  exception_type: string;
  question: string;
  status: PackDecisionStatus;
  partial_shipment: boolean | null;
  raised_by: number;
  raised_at: string;
  resolved_by: number | null;
  resolved_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * raisePackDecisionRequest
 * ------------------------
 * Called by packer when item_missing or short_pick is encountered.
 * Creates the decision request and notifies the owner.
 *
 * Returns the created request ID so mobile can poll for resolution.
 */
export async function raisePackDecisionRequest(
  trx: Knex.Transaction,
  input: RaisePackDecisionInput
): Promise<PackDecisionRequest> {
  const {
    shopId, pickBatchId, lasyncroOrderId, lasyncroLineItemId,
    exceptionType, question, raisedBy,
  } = input;

  // Check for existing pending request on this line — return it if already raised
  // Idempotent: packer may retry if network fails after insert
  const existing = await trx('pack_decision_requests')
    .where({
      shop_id:               shopId,
      pick_batch_id:         pickBatchId,
      lasyncro_order_id:     lasyncroOrderId,
      lasyncro_line_item_id: lasyncroLineItemId,
    })
    .first();

  if (existing) return existing as PackDecisionRequest;

  const [request] = await trx('pack_decision_requests')
    .insert({
      shop_id:               shopId,
      pick_batch_id:         pickBatchId,
      lasyncro_order_id:     lasyncroOrderId,
      lasyncro_line_item_id: lasyncroLineItemId,
      exception_type:        exceptionType,
      question,
      status:                'pending',
      raised_by:             raisedBy,
      raised_at:             trx.fn.now(),
    })
    .returning('*');

  // Fire alert for owner (warehouse_floor, owner audience)
  await firePickExceptionAlert(trx, {
    shopId,
    batchId:       pickBatchId,
    stage:         'pack',
    exceptionType,
    variantTitle:  undefined,
  });

  // Push notification — owner needs to respond to unblock packer
  const batchShort = pickBatchId.slice(0, 8).toUpperCase();
  const questionLabel = question === 'ship_partial'
    ? 'Ship partial or hold?'
    : 'Hold and requeue?';

  dispatchNotification({
    shopId,
    payload: {
      title: `Pack decision needed — ${exceptionType.replace(/_/g, ' ')}`,
      body:  `Batch ${batchShort}: ${questionLabel} Packer is waiting.`,
      data:  { route: '/wms', batchId: pickBatchId },
    },
    broadcastToRole: 'owner',
  }).catch((err) => console.error('[PACK_DECISION_PUSH_FAILED]', err.message));

  console.info('[PACK_DECISION_RAISED]', {
    id: request.id, shopId, pickBatchId, lasyncroOrderId, exceptionType, question,
  });

  return request as PackDecisionRequest;
}

/**
 * getPackDecisionRequest
 * ----------------------
 * Mobile polls this until status !== 'pending'.
 * Returns 404 if not found (packer should re-raise).
 */
export async function getPackDecisionRequest(
  trx: Knex.Transaction,
  requestId: string,
  shopId: number
): Promise<PackDecisionRequest | null> {
  const request = await trx('pack_decision_requests')
    .where({ id: requestId, shop_id: shopId })
    .first();

  return (request as PackDecisionRequest) ?? null;
}

/**
 * resolvePackDecisionRequest
 * --------------------------
 * Owner/admin approves or rejects.
 * - approved + partial_shipment=true  → packer ships without missing item
 * - approved + partial_shipment=false → packer holds (treated as requeue)
 * - rejected                          → order removed from batch, re-queued
 *
 * Returns updated request — mobile uses status + partial_shipment to proceed.
 */
export async function resolvePackDecisionRequest(
  trx: Knex.Transaction,
  input: ResolvePackDecisionInput
): Promise<PackDecisionRequest> {
  const { requestId, shopId, resolvedBy, status, partialShipment, note } = input;

  const existing = await trx('pack_decision_requests')
    .where({ id: requestId, shop_id: shopId })
    .first();

  if (!existing) throw new Error('PACK_DECISION_NOT_FOUND');
  if (existing.status !== 'pending') throw new Error('PACK_DECISION_ALREADY_RESOLVED');

  const [updated] = await trx('pack_decision_requests')
    .where({ id: requestId, shop_id: shopId })
    .update({
      status,
      partial_shipment: status === 'approved' ? (partialShipment ?? false) : null,
      resolved_by:      resolvedBy,
      resolved_at:      trx.fn.now(),
      note:             note ?? null,
      updated_at:       trx.fn.now(),
    })
    .returning('*');

  /**
   * REQUEUE ON REJECTION
   * --------------------
   * Remove order from pick_batch_orders so it re-surfaces in the
   * order pool (GET /wms/order-pool filters WHERE pick_batch_orders IS NULL).
   * order_warehouse_status is NOT touched — monotonic trigger blocks
   * backward transitions. The order stays in its current warehouse
   * status for audit; what matters for re-release is the pool query.
   * order_fulfillment_status remains pending/processing — unchanged.
   */
  if (status === 'rejected') {
    await trx('pick_batch_orders')
      .where({
        lasyncro_order_id: existing.lasyncro_order_id,
        shop_id:           shopId,
      })
      .delete();

    console.info('[PACK_DECISION_ORDER_REQUEUED]', {
      requestId,
      lasyncroOrderId: existing.lasyncro_order_id,
      pickBatchId:     existing.pick_batch_id,
      shopId,
      resolvedBy,
    });
  }

  console.info('[PACK_DECISION_RESOLVED]', {
    id: requestId, shopId, status, partialShipment, resolvedBy,
  });

  return updated as PackDecisionRequest;
}
