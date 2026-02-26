// apps/backend/src/api/shopify/handlers/handleOrderCreated.ts

import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../../../queue.js';

type ShopifyOrderCreatePayload = {
  id: number | string;
  admin_graphql_api_id?: string;
  currency: string;
  total_price: string | number;
  subtotal_price?: string | number;
  total_tax?: string | number;
  created_at: string;
  updated_at: string;
  processed_at?: string;
  source_name?: string;
  line_items?: Array<{
    id: number | string;
    product_id?: number | string;
    variant_id?: number | string;
    title: string;
    sku?: string;
    quantity: number;
    price: string | number;
  }>;
};

export async function handleOrderCreated(
  envelope: WebhookEnvelope
): Promise<void> {

  const raw = envelope.rawPayload as Partial<ShopifyOrderCreatePayload>;

  console.log('[ORDER CREATE HANDLER] ENTERED');

  const shopDomain = envelope.shopDomain;

  if (!raw?.id || !raw.created_at || !raw.updated_at || !shopDomain) {
    console.error('[ORDER CREATE GUARD FAILED]', {
      hasId: !!raw?.id,
      hasCreatedAt: !!raw?.created_at,
      hasUpdatedAt: !!raw?.updated_at,
      shopDomain,
    });

    return;
  }


  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) {
    console.error('[ORDER CREATE INSTALLATION NOT FOUND]', {
      shopDomain,
    });
    return;
  }

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   * ---------------------------------
   * Canonical event-time must be persisted at ingestion boundary.
   * Never rely on worker-only extraction.
   */
  const eventTime = raw.created_at ?? null;

  if (!eventTime) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Order create missing created_at at ingestion'
    );
  }

  const shopId = installation.shop_id;

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

  const [staged] = await db('staged_events')
    .insert({
      shop_id: shopId,
      event_type: 'orders/create',
      raw_payload: raw,
      source_platform: 'shopify',
      external_event_id: envelope.eventId,
      event_time: new Date(eventTime),
    })
    .returning('*');

  console.log('[STAGED INSERTED]', staged.id);

  getQueueChannel('events').sendToQueue(
    'events',
    Buffer.from(JSON.stringify({ staged_event_id: staged.id }))
  );
}
