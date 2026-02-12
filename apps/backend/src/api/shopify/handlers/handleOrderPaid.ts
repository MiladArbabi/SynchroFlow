// apps/backend/src/api/shopify/handlers/handleOrderPaid.ts

import { WebhookEnvelope } from 'api-src/api/webhooks/types';
import db from 'api-src/db';

/**
 * Shopify ORDERS_PAID Handler
 * ----------------------------
 * Economic Confirmation Boundary.
 *
 * Responsibilities:
 * - Transition canonical_orders.payment_state → 'paid'
 * - Enforce deterministic state transitions
 * - Remain replay-safe
 *
 * HARD RULES:
 * - Only 'unpaid' → 'paid' is allowed
 * - 'paid' → 'paid' is noop
 * - Any other transition is illegal and throws
 *
 * No fulfillment logic.
 * No revenue logic.
 * No inference.
 */

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

  const canonicalPlatformOrderId = String(rawPayload.id).startsWith('gid://')
    ? String(rawPayload.id).replace('gid://shopify/Order/', '')
    : String(rawPayload.id);

  const order = await db('canonical_orders')
    .where({
      shop_id: shopId,
      platform_order_id: canonicalPlatformOrderId,
    })
    .first();

  if (!order) {
    // Canonical not yet present — ignore safely
    return;
  }

  const currentState = order.payment_state;

  if (currentState === 'paid') {
    return; // replay-safe noop
  }

  if (currentState !== 'unpaid') {
    throw new Error(
      `[ECONOMIC_STATE_VIOLATION] Illegal transition ${currentState} → paid`
    );
  }

  await db('canonical_orders')
    .where({ canonical_order_id: order.canonical_order_id })
    .update({
      payment_state: 'paid',
      updated_at: db.fn.now(),
    });
}
