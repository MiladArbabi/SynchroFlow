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
   * NOTE:
   * Idempotency must be enforced at domain boundary.
   * No mutable ingestion buffer.
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
    );
  }

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
   * INGESTION EVENT-TIME ENFORCEMENT
   * ---------------------------------
   * Refund must carry canonical event-time.
   * Accepted field:
   * - created_at
   */
  if (!refundCreatedAt) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Refund missing event_time at ingestion'
    );
  }

   /**
     * IMMUTABLE DOMAIN EVENT INSERT
     * -----------------------------
     * Append-only canonical event log.
     */
    const [domainEventId] = await db('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'refunds/create',
        event_payload: rawPayload,
        event_time: new Date(refundCreatedAt),
        event_version: 1,
        event_sequence: db.raw(
          `
          COALESCE(
            (SELECT MAX(event_sequence) + 1
            FROM domain_events
            WHERE shop_id = ?),
            1
          )
          `,
          [shopId]
        ),
      })
      .returning('id');

      const finalDomainEventId =
      typeof domainEventId === 'object' && domainEventId !== null
        ? (domainEventId as any).id
        : domainEventId;

    getQueueChannel('events').sendToQueue(
      'events',
      Buffer.from(
        JSON.stringify({ domain_event_id: finalDomainEventId })
      )
    );
}
