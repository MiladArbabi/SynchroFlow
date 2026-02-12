/**
 * REFUND EXECUTION CONTRACT
 * ------------------------
 * - refund_executions is the ONLY source of financial truth
 * - Webhooks may replay; platform_refund_id enforces idempotency
 * - Revenue mutation happens in a separate resolver phase
 * - canonical_returns is deprecated and must not be written
 */

// apps/backend/src/api/shopify/handlers/handleRefundCreated.ts

import db from 'api-src/db';
import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import { resolveRefundExecution } from 'api-src/workers/refundResolution.worker';

/**
 * Minimal Shopify Refund Payload (Execution-Safe)
 * -----------------------------------------------
 * This is NOT a full Shopify type.
 * It includes ONLY fields required for refund execution truth.
 */
type ShopifyRefundPayload = {
  id: number | string;
  order_id: number | string;
  created_at?: string;
  refund_line_items?: Array<{
    quantity?: number;
    subtotal?: string | number;
    line_item?: {
      id?: number | string;
    };
  }>;
};

/**
 * Shopify refunds/create webhook handler.
 *
 * Responsibilities:
 * - Persist webhook payload (idempotent via ledger)
 * - Stage raw payload for downstream ingestion
 * - Enqueue refunds ingestion worker
 *
 * No parsing. No inference. No mutation.
 */
export async function handleRefundCreated(
  envelope: WebhookEnvelope
): Promise<void> {
  const { shopId, rawPayload } = envelope;

  console.log('[REFUND_HANDLER_ENTRY]', {
    shopId,
    hasRawPayload: !!rawPayload,
  });

  /**
   * Runtime type narrowing for refund execution.
   * If payload does not match minimum refund shape,
   * execution is skipped safely.
   */

  /**
   * IMPORTANT:
   * WebhookEnvelope.rawPayload is intentionally untyped.
   * We narrow locally to avoid leaking Shopify semantics
   * beyond the execution boundary.
   *
   * This preserves:
   * - transport correctness
   * - execution authority
   * - future replay safety
   */
  const refundPayload = rawPayload as Partial<ShopifyRefundPayload>;

  // Refunds may arrive without resolved shopId.
  // Resolution happens downstream via canonical_orders.

  /**
   * Refund Execution — Authoritative Write
   * -------------------------------------
   * This writes financial truth only.
   * No revenue mutation. No inference.
   */
  const refundId = refundPayload.id;
  const platformOrderId = refundPayload.order_id;
  const refundCreatedAt = refundPayload.created_at;

  if (!refundId || !platformOrderId) {
    return;
  }

  await db.transaction(async trx => {
    const canonicalOrder = await trx('canonical_orders')
      .where({ platform_order_id: String(platformOrderId) })
      .first();

    await trx('refund_executions')
      .insert({
        shop_id: shopId ?? null,
        platform: 'shopify',
        platform_refund_id: String(refundId),
        canonical_order_id: canonicalOrder?.canonical_order_id ?? null,
        platform_order_id: String(platformOrderId),
        refund_created_at: refundCreatedAt
          ? new Date(refundCreatedAt)
          : new Date(),
        execution_source: 'observed',
      })
      .onConflict(['platform', 'platform_refund_id'])
      .ignore();

    const execution = await trx('refund_executions')
      .where({
        platform: 'shopify',
        platform_refund_id: String(refundId),
      })
      .first();

    const refundLineItems = refundPayload.refund_line_items ?? [];

    for (const rli of refundLineItems) {
      const platformLineItemId = rli?.line_item?.id;
      const qty = Number(rli?.quantity);
      const amount = Number(rli?.subtotal);

      if (!platformLineItemId || !Number.isFinite(qty) || qty <= 0) continue;

      await trx('refund_execution_line_items')
        .insert({
          refund_execution_id: execution.id,
          canonical_order_id: execution.canonical_order_id,
          sku: String(platformLineItemId), // TEMP identity (resolver will fix)
          quantity_refunded: qty,
          unit_refund_amount: Number.isFinite(amount) ? amount : null,
        })
        .onConflict(['refund_execution_id', 'sku'])
        .ignore();
    }
  });

  /**
   * REFUND DERIVED EFFECT APPLICATION
   * ---------------------------------
   * Refund executions are financial truth.
   * Derived state (revenue units, refund aggregation, blocks)
   * must be applied immediately to guarantee:
   *
   * - Deterministic economic lifecycle
   * - No dependency on fulfillment reconciliation
   * - Replay-safe idempotency
   *
   * Safe because:
   * - resolveRefundExecution is idempotent
   * - It mutates derived state only
   */
  const execution = await db('refund_executions')
    .where({
      platform: 'shopify',
      platform_refund_id: String(refundId),
    })
    .first();

  if (execution?.id) {
    await resolveRefundExecution(execution.id);
  }
}
