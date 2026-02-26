// apps/backend/src/api/shopify/handlers/handleOrderPaid.ts
import { getQueueChannel } from '../../../queue.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';

type ShopifyOrderPaidPayload = {
  id?: string | number;
  updated_at?: string;
  processed_at?: string;
};

function isOrderPaidPayload(payload: unknown): payload is ShopifyOrderPaidPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'id' in payload
  );
}

export async function handleOrderPaid(
  envelope: WebhookEnvelope
): Promise<void> {

  const rawPayload = envelope.rawPayload;

  if (!isOrderPaidPayload(rawPayload)) {
    return;
  }

  const shopDomain = envelope.shopDomain;
  if (!shopDomain) return;

  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) return;

  const shopId = installation.shop_id;

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   * ---------------------------------
   * Payment must carry canonical event-time.
   * Accepted fields:
   * - updated_at
   * - processed_at
   */
  const eventTime =
    (rawPayload as any).updated_at ??
    (rawPayload as any).processed_at ??
    null;

  if (!eventTime) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Payment missing event_time at ingestion'
    );
  }

  /**
   * IDEMPOTENCY ENFORCEMENT
   * -----------------------
   * Upstream eventId must be persisted
   * to activate unique constraint on staged_events.
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
    );
  }

  /**
   * PAYMENT STAGING (UNIFIED INGESTION)
   * ------------------------------------
   * Payment state transitions must be handled
   * exclusively by canonical worker.
   */
    const [staged] = await db('staged_events')
    .insert({
      source_platform: 'shopify',
      event_type: 'orders/paid',
      raw_payload: rawPayload,
      shop_id: shopId,
      external_event_id: envelope.eventId,
      event_time: new Date(eventTime),
    })
    .returning('*');

  getQueueChannel('events').sendToQueue(
    'events',
    Buffer.from(JSON.stringify({ staged_event_id: staged.id }))
  );
}
