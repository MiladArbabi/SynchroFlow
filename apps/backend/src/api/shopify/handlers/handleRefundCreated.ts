/**
 * REFUND EXECUTION CONTRACT
 * ------------------------
 * - refund_executions is the ONLY source of financial truth
 * - Webhooks may replay; platform_refund_id enforces idempotency
 * - Revenue mutation happens in a separate resolver phase
 */

// apps/backend/src/api/shopify/handlers/handleRefundCreated.ts

import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../../../queue.js';

import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import { resolveRefundExecution } from '../../../workers/refundResolution.worker.js';
import { resolveExternalOrderId } from '../../../services/identity/resolveExternalOrder.service.js';

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

  const { rawPayload, shopDomain } = envelope;

  console.log('[REFUND_HANDLER_ENTRY]', {
    shopDomain,
    hasRawPayload: !!rawPayload,
  });

  if (!shopDomain) return;

  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) return;

  const shopId = installation.shop_id;

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

  /**
   * Refund Execution — Authoritative Write
   * -------------------------------------
   * This writes financial truth only.
   * No revenue mutation. No inference.
   */
  const refundId = refundPayload.id;
  const platformOrderId = refundPayload.order_id;
  const refundCreatedAt = refundPayload.created_at;

  console.log('REFUND platformOrderId', platformOrderId);

  if (!refundId || !platformOrderId) {
    return;
  }

   /**
   * REFUND STAGING (UNIFIED INGESTION)
   * -----------------------------------
   * Refunds must enter canonical pipeline via staged_events.
   * After persistence, we MUST enqueue the staged_event_id
   * to the 'events' queue so the unified worker can process it.
   *
   * Without this, refund executions will never materialize.
   */
    const [id] = await db('staged_events')
    .insert({
      source_platform: 'shopify',
      event_type: 'refunds/create',
      raw_payload: rawPayload,
      shop_id: shopId,
    })
    .returning('id');

  /**
   * Normalize Knex returning shape.
   * In some drivers `.returning('id')` yields:
   * - { id: number }
   * - number
   *
   * Canonical worker expects integer staged_event_id.
   */
  const stagedEventId =
    typeof id === 'object' && id !== null
      ? (id as any).id
      : id;

  getQueueChannel('events').sendToQueue(
    'events',
    Buffer.from(JSON.stringify({ staged_event_id: stagedEventId }))
  );
}
