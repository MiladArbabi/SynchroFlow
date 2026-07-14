// apps/backend/src/api/webhooks/adapters/stripe.adapter.ts
//
// Stripe → WebhookEnvelope adapter.
//
// shopId resolution priority (A-04 fix):
//   1. event.data.object.metadata.shopId  (subscription/invoice objects)
//   2. event.data.object.metadata.shop_id (alternate casing)
//   3. Absent → shopId left undefined; WebhookRouter resolves via shopDomain
//
// NOTE: Stripe events have no shopDomain equivalent.
// shopId MUST be set in Stripe object metadata at checkout session creation.
// If metadata is missing, the webhook router will hard-fail with WEBHOOK_MISSING_SHOP_ID.
// This is intentional — fail loud rather than silently misroute.

import { buildWebhookEnvelope } from '../buildWebhookEnvelope.js';
import { WebhookEnvelope } from '../types.js';

export class StripeWebhookAdapter {
  static toEnvelope(req: any): WebhookEnvelope {
    const event = req.body;
    const metadata = event?.data?.object?.metadata ?? {};
    // Resolve shopId from metadata — support both camelCase and snake_case keys
    const rawShopId = metadata.shopId ?? metadata.shop_id ?? null;
    const shopId = rawShopId !== null && !isNaN(Number(rawShopId))
      ? Number(rawShopId)
      : undefined;
    if (shopId === undefined) {
      console.warn('[stripe.adapter] shopId missing from event metadata', {
        eventId: event?.id,
        eventType: event?.type,
      });
    }
    return buildWebhookEnvelope({
      integration: 'stripe',
      eventId: event.id,
      eventType: event.type,
      // ISS-B06: rawPayload must be the unwrapped Stripe resource
      // (subscription/invoice/session), not the full event envelope.
      // Every handler (handleSubscriptionUpsert, handleInvoicePaid,
      // handleSubscriptionDeleted) reads fields directly off rawPayload
      // (sub.metadata, sub.customer, sub.id) — was silently broken for
      // every real Stripe webhook until this fix, confirmed via a
      // synthetic customer.subscription.created test (2026-07-14).
      rawPayload: event?.data?.object ?? event,
      shopId,
    });
  }
}