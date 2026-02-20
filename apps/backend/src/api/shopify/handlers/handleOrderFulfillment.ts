// apps/backend/src/api/shopify/handlers/handleOrderFulfillment.ts
import { WebhookEnvelope } from '../../../api/webhooks/types.js';
import db from '@lasyncro/backend-core/db.js';
import 
  OrderFulfillmentIngestionService from 
'../../../services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.js';

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
        ? 'fulfilled'
        : 'processing';

  /**
   * Webhook execution mapping
   * --------------------------
   * Shopify does not provide a true "in_transit" state.
   * Execution transitions are simplified into sovereign states.
   */
  await OrderFulfillmentIngestionService.ingestStatus({
    lasyncroOrderId,
    status: fulfillmentStatus as
      | 'processing'
      | 'fulfilled'
      | 'cancelled',
  });

  // Reconciliation scheduling removed.
  // Economic materialization occurs deterministically at ingestion boundary.
};
