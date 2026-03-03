// apps/backend/src/api/shopify/handlers/handleOrderFulfillment.ts
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';
import { ensureOrderIdentityExists }
  from '../../../services/order-identity-guard.service.js';

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
    console.error('[FULFILLMENT_INGESTION_REJECTED][INVALID_PAYLOAD]', {
      receivedKeys: rawPayload ? Object.keys(rawPayload as any) : null
    });
    throw new Error('FULFILLMENT_INVALID_PAYLOAD');
  }

  const shopDomain = envelope.shopDomain;
  if (!shopDomain) {
    console.error('[FULFILLMENT_INGESTION_REJECTED][MISSING_SHOP_DOMAIN]');
    throw new Error('FULFILLMENT_MISSING_SHOP_DOMAIN');
  }

  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) {
    console.error('[FULFILLMENT_INGESTION_REJECTED][INSTALLATION_NOT_FOUND]', {
      shopDomain
    });
    throw new Error('FULFILLMENT_INSTALLATION_NOT_FOUND');
  }

  const shopId = installation.shop_id;

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
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
   * INGESTION IDENTITY ENFORCEMENT
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
    );
  }

  /**
   * FULFILLMENT IDENTITY GUARD
   * --------------------------
   * Fulfillment must never enter canonical layer
   * before baseline order exists.
   *
   * If identity missing:
   * - Fetch order via Shopify GraphQL
   * - Emit orders/sync
   *
   * Deterministic and replay-safe.
   */
  const externalOrderId = String(rawPayload.order_id);

  await ensureOrderIdentityExists(
    shopId,
    shopDomain,
    externalOrderId
  );

  let domainEventId: number;

  try {
    const result = await db('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'orders/fulfilled',
        event_payload: rawPayload,
        event_time: new Date(eventTime),
        event_version: 1,
        external_event_id: envelope.eventId,
      })
      .returning('id');

    domainEventId = result[0].id ?? result[0];
    
  } catch (error: any) {

    /**
     * DUPLICATE DELIVERY HANDLING
     * ---------------------------
     * Unique constraint:
     * (shop_id, external_event_id)
     */
    if (error?.code === '23505') {

      console.warn('[DOMAIN_EVENT_DUPLICATE]', {
        shopId,
        externalEventId: envelope.eventId,
        eventType: 'orders/fulfilled',
      });

      return; // Do NOT enqueue duplicate
    }

    throw error;
  }
}