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
   * FULFILLMENT STAGING (UNIFIED INGESTION)
   * ----------------------------------------
   * Fulfillment state transitions must enter
   * canonical pipeline via staged_events only.
   */
  const [id] = await db('staged_events')
    .insert({
      source_platform: 'shopify',
      event_type: 'orders/fulfilled',
      raw_payload: rawPayload,
      shop_id: shopId,
      external_event_id: envelope.eventId,
      event_time: new Date(eventTime),
    })
    .returning('id');

  const stagedEventId =
    typeof id === 'object' ? id.id : id;

  const channel = getQueueChannel('events');

  channel.sendToQueue(
    'events',
    Buffer.from(JSON.stringify({ staged_event_id: stagedEventId }))
  );
};
