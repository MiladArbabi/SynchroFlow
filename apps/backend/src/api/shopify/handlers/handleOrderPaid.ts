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
   * NOTE:
   * Idempotency must be enforced at domain boundary.
   * No mutable ingestion buffer is used.
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
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
      event_type: 'orders/paid',
      event_payload: rawPayload,
      event_time: new Date(eventTime),
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

  getQueueChannel('events').sendToQueue(
    'events',
    Buffer.from(
      JSON.stringify({
        domain_event_id: domainEventId.id ?? domainEventId,
      })
    )
  );
}
