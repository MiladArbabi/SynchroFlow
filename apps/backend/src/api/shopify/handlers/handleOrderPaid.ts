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
   * CANONICAL EXTERNAL ID ENFORCEMENT
   * ----------------------------------
   * External identity must equal webhook payload.id string.
   * No GID wrapping. No transformation.
   */
  const externalOrderId = String(rawPayload.id);

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

  const order = await db('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .first();

  if (!order) return;

  const currentState = order.payment_state;

  if (currentState === 'paid') {
    return;
  }

  if (currentState !== 'unpaid') {
    throw new Error(
      `[ECONOMIC_STATE_VIOLATION] Illegal transition ${currentState} → paid`
    );
  }

  await db('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .update({
      payment_state: 'paid',
      updated_at: db.fn.now(),
    });
}
