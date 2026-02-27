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
   * NOTE:
   * Idempotency must be enforced at domain boundary,
   * not via mutable ingestion buffer.
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
    );
  }

  /**
   * IMMUTABLE DOMAIN EVENT INSERT
   * -----------------------------
   * No ingestion state.
   * No retry tracking.
   * Deterministic rebuild source of truth.
   */
  const [domainEventId] = await db('domain_events')
    .insert({
      shop_id: shopId,
      event_type: 'orders/create',
      event_payload: raw,
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

  console.log('[DOMAIN_EVENT_INSERTED]', domainEventId.id ?? domainEventId);

  getQueueChannel('events').sendToQueue(
    'events',
      Buffer.from(
        JSON.stringify({
          domain_event_id: domainEventId.id ?? domainEventId,
        })
      )
  );
}
