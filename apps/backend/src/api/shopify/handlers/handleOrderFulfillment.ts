// apps/backend/src/api/shopify/handlers/handleOrderFulfillment.ts

import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import db from 'api-src/db';
import OrderFulfillmentIngestionService from 'api-src/services/order-fulfillment-ingestion/orderFulfillmentIngestion.service';
import { publishReconciliationJob } from 'api-src/queues/reconciliation.queue';

type ShopifyFulfillmentPayload = {
  id: string | number;
  order_id: string | number;
  status?: string | null;
  fulfillment_status?: string | null;
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

  const externalOrderId = String(rawPayload.order_id).startsWith('gid://')
    ? String(rawPayload.order_id)
    : `gid://shopify/Order/${rawPayload.order_id}`;

  // Resolve sovereign identity
  const identity = await db('external_order_identity_map')
    .where({
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    })
    .select('lasyncro_order_id')
    .first();

  if (!identity) {
    return;
  }

  const lasyncroOrderId = identity.lasyncro_order_id;

  const fulfillmentStatus =
    rawPayload.status === 'cancelled'
      ? 'cancelled'
      : rawPayload.fulfillment_status === 'fulfilled'
        ? 'delivered'
        : 'processing';

  await OrderFulfillmentIngestionService.ingestStatus({
    lasyncroOrderId,
    status: fulfillmentStatus as
      | 'processing'
      | 'in_transit'
      | 'delivered'
      | 'cancelled',
  });

  if (fulfillmentStatus === 'delivered') {
    await publishReconciliationJob(lasyncroOrderId, {
      status: 'delivered',
      observedAt: new Date(),
      source: 'shopify_sync',
    });
  }
}
