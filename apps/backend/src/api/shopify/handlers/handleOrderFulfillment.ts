// apps/backend/src/api/shopify/handlers/handleOrderFulfillment.ts

import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import db from 'api-src/db';
import OrderFulfillmentIngestionService
  from 'api-src/services/order-fulfillment-ingestion/orderFulfillmentIngestion.service';

/**
 * Minimal Shopify fulfillment payload (local, structural)
 * ------------------------------------------------------
 * This type is intentionally:
 * - Partial
 * - Non-exhaustive
 * - Handler-scoped
 *
 * Rationale:
 * - WebhookEnvelope is payload-agnostic by design
 * - We narrow only what we explicitly read
 * - Everything else is treated as absent
 */
type ShopifyFulfillmentPayload = {
  id: string | number;
  order_id: string | number;
  status?: string | null;
  fulfillment_status?: string | null;
};

/**
 * Runtime payload guard (fail-closed)
 * ----------------------------------
 * Ensures we only proceed when the minimal
 * structural contract is satisfied.
 */
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

/**
 * Handle Shopify Fulfillment Events
 * --------------------------------
 * Authoritative ingestion of fulfillment state.
 *
 * Rules:
 * - No inference
 * - No revenue logic
 * - No FT2 logic
 * - Canonical linkage only when resolvable
 */
export async function handleOrderFulfillment(
  envelope: WebhookEnvelope
): Promise<void> {
  console.log('[FULFILLMENT HANDLER] ENTERED');

  const rawPayload = envelope.rawPayload;

  // Fail-closed: unexpected payload shape
  if (!isShopifyFulfillmentPayload(rawPayload)) {
    return;
  }

  let shopDomain = envelope.shopDomain;
  if (!shopDomain) return; // keep strict for real Shopify

  /**
   * Resolve shopId
   * --------------
   * Mirrors uninstall logic assumptions.
   */
  const installation = await db('shopify_app_installations')
    .where({ shop_domain: shopDomain })
    .select('shop_id')
    .first();

  if (!installation) return;

  const shopId = installation.shop_id;

  /**
   * Platform execution order id (external identity)
   * -----------------------------------------------
   * Stored verbatim to preserve linkage with
   * upstream systems and webhooks.
   */
  const platformOrderId = String(rawPayload.order_id).startsWith('gid://')
    ? String(rawPayload.order_id)
    : `gid://shopify/Order/${rawPayload.order_id}`;


  /**
   * Canonical platform order id
   * ---------------------------
   * Canonical orders store Shopify order IDs WITHOUT GID prefix.
   * Fulfillment payloads may arrive as number or gid.
   *
   * This normalization is REQUIRED for deterministic joins.
   */
  const canonicalPlatformOrderId = String(rawPayload.order_id).startsWith('gid://')
    ? String(rawPayload.order_id).replace('gid://shopify/Order/', '')
    : String(rawPayload.order_id);

  const canonical = await db('canonical_orders')
    .where({
      shop_id: shopId,
      platform_order_id: canonicalPlatformOrderId,
    })
    .select('canonical_order_id')
    .first();

  /**
   * Fulfillment state normalization
   * -------------------------------
   * Normalize Shopify states into FT0-safe states.
   */
  const fulfillmentStatus =
    rawPayload.status === 'cancelled'
      ? 'cancelled'
      : rawPayload.fulfillment_status === 'fulfilled'
        ? 'delivered'
        : 'processing';

  console.log('[FULFILLMENT HANDLER] INGESTING', {
    shopId,
    platformOrderId,
    canonicalOrderId: canonical?.canonical_order_id ?? null,
    status: fulfillmentStatus,
  });

  await OrderFulfillmentIngestionService.ingestStatus({
    shopId,
    platformOrderId,
    canonicalOrderId: canonical?.canonical_order_id ?? null,
    status: fulfillmentStatus,
  });
}
