// apps/backend/src/api/shopify/handlers/handleRefundCreated.ts
import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import db from 'api-src/db';
import { enqueueWebhookEnvelope } from 'api-src/api/webhooks/dispatchQueue';

/**
 * Minimal Shopify refund payload (structural)
 * ------------------------------------------
 * We ONLY assert what we must read.
 */
type ShopifyRefundPayload = {
  id: number | string;
  order_id: number | string;
  refund_line_items?: unknown[];
};

function isShopifyRefundPayload(
  payload: unknown
): payload is ShopifyRefundPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'id' in payload &&
    'order_id' in payload
  );
}

/**
 * Handle Shopify refunds/create
 * -----------------------------
 * Transport-only ingress.
 * NO revenue logic.
 * NO mutation.
 */
export async function handleRefundCreated(
  envelope: WebhookEnvelope
): Promise<void> {
  const rawPayload = envelope.rawPayload;

  if (!isShopifyRefundPayload(rawPayload)) {
    return;
  }

  const shopDomain = envelope.shopDomain;
  if (!shopDomain) return;

  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) return;

  await enqueueWebhookEnvelope({
    ...envelope,
    shopId: installation.shop_id,
  });

  console.log('[REFUND HANDLER] ENQUEUED', {
    shopId: installation.shop_id,
    refundId: rawPayload.id,
    orderId: rawPayload.order_id,
  });
}
