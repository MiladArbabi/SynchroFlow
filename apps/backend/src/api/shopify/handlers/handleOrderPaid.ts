// apps/backend/src/api/shopify/handlers/handleOrderPaid.ts

import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';

type ShopifyOrderPaidPayload = {
  id?: string | number;
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
   * PAYMENT STAGING (UNIFIED INGESTION)
   * ------------------------------------
   * Payment state transitions must be handled
   * exclusively by canonical worker.
   */
  await db('staged_events').insert({
    source_platform: 'shopify',
    event_type: 'orders/paid',
    raw_payload: rawPayload,
    shop_id: shopId,
  });
}
