// apps/backend/src/api/billing/handlers/handleCheckoutSetupComplete.ts
//
// Handles: checkout.session.completed
//
// Responsibility:
//   Persist stripe_customer_id for a pay-per-order setup session
//   (SEG-022-B). No entitlements, no tier change — this session
//   carries no price/subscription, just a saved payment method.
//
// GUARD: checkout.session.completed also fires for ordinary paid
// subscription checkouts (mode:'subscription'). Those are already
// fully handled by customer.subscription.created via
// handleSubscriptionUpsert. This handler must only act on our own
// mode:'setup' sessions — identified by metadata.purpose — and
// no-op for everything else to avoid double-processing or
// overwriting a subscription's richer upsert.
//
// HARD RULES:
//   - Idempotent (upsert on shop_id, single column)
//   - Never touches tier/status/entitlements — setup-only

import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../webhooks/types.js';

export async function handleCheckoutSetupComplete(envelope: WebhookEnvelope): Promise<void> {
  // rawPayload is the full Stripe event envelope ({id, type, data: {object}}),
  // not the Checkout Session itself — must unwrap one level.
  const session = (envelope.rawPayload as any)?.data?.object;
  const shopId = envelope.shopId;

  if (session?.mode !== 'setup' || session?.metadata?.purpose !== 'pay_per_order_setup') {
    // Not our session type — ordinary subscription checkout, ignore.
    return;
  }

  if (!shopId) {
    console.error('[billing][checkout_setup_complete] missing shopId', { eventId: envelope.eventId });
    throw new Error('[billing][checkout_setup_complete] shopId required');
  }

  const stripeCustomerId = session?.customer ?? null;
  if (!stripeCustomerId) {
    console.error('[billing][checkout_setup_complete] missing customer id', {
      eventId: envelope.eventId,
      shopId,
    });
    throw new Error('[billing][checkout_setup_complete] stripe customer id required');
  }

  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
    await trx('shop_subscriptions')
      .where({ shop_id: shopId })
      .update({ stripe_customer_id: stripeCustomerId, updated_at: new Date() });
  });

  console.log('[billing][checkout_setup_complete] complete', {
    shopId,
    stripeCustomerId,
    eventId: envelope.eventId,
  });
}