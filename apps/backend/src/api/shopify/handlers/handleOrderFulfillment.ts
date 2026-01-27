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
    'id' in payload
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
  const rawPayload = envelope.rawPayload;

  // Fail-closed: unexpected payload shape
  if (!isShopifyFulfillmentPayload(rawPayload)) {
    return;
  }

  const shopDomain = envelope.shopDomain;
  if (!shopDomain) return;

  /**
   * Resolve shopId
   * --------------
   * Mirrors uninstall logic assumptions.
   */
  const shop = await db('shops')
    .where({ domain: shopDomain })
    .select('id')
    .first();

  if (!shop) return;

  /**
   * Shopify semantics
   * -----------------
   * id is platform-native order identifier.
   */
  const platformOrderId = String(rawPayload.id);

  /**
   * Resolve canonical order (best-effort)
   * -------------------------------------
   * No guessing. No fallback.
   */
  const canonical = await db('canonical_orders')
    .where({
      shop_id: shop.id,
      platform_order_id: platformOrderId,
    })
    .select('canonical_order_id')
    .first();

  /**
   * Fulfillment state normalization
   * -------------------------------
   * Normalize Shopify states into FT0-safe states.
   */
  const fulfillmentStatus =
    rawPayload.fulfillment_status === 'fulfilled'
      ? 'delivered'
      : rawPayload.fulfillment_status === 'partial'
        ? 'processing'
        : rawPayload.fulfillment_status === 'cancelled'
          ? 'cancelled'
          : 'processing';

  await OrderFulfillmentIngestionService.ingestStatus({
    shopId: shop.id,
    platformOrderId,
    canonicalOrderId: canonical?.canonical_order_id ?? null,
    status: fulfillmentStatus,
  });
}
