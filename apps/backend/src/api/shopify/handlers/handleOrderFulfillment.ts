// apps/backend/src/api/shopify/handlers/handleOrderFulfillment.ts
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../../../queue.js';
import 
  OrderFulfillmentIngestionService from 
'../../../services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';

type ShopifyFulfillmentPayload = {
  id: string | number;
  order_id: string | number;
  status?: string | null;
  fulfillment_status?: string | null;
  updated_at?: string;
  created_at?: string;
};

function isShopifyFulfillmentPayload(
  payload: unknown
): payload is ShopifyFulfillmentPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'id' in payload &&
    'order_id' in payload
  );
}

export async function handleOrderFulfillment(
  envelope: WebhookEnvelope
): Promise<void> {

  const rawPayload = envelope.rawPayload;

  if (!isShopifyFulfillmentPayload(rawPayload)) {
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
   * Fulfillment must carry canonical event-time.
   * Accepted fields:
   * - updated_at
   * - created_at
   */
  const eventTime =
    (rawPayload as any).updated_at ??
    (rawPayload as any).created_at ??
    null;

  if (!eventTime) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Fulfillment missing event_time at ingestion'
    );
  }

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
   * IMMUTABLE DOMAIN EVENT INSERT
   * -----------------------------
   * Append-only canonical event log.
   */
  const [domainEventId] = await db('domain_events')
    .insert({
      shop_id: shopId,
      event_type: 'orders/fulfilled',
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

  const finalDomainEventId =
    typeof domainEventId === 'object'
      ? domainEventId.id
      : domainEventId;

  const channel = getQueueChannel('events');

  channel.sendToQueue(
    'events',
      Buffer.from(
        JSON.stringify({
          domain_event_id: finalDomainEventId,
        })
      )
  );
};
