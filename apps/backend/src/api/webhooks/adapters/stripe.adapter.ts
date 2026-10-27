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
    const isPaidInvoice = event?.type === 'invoice.payment_succeeded';

    let shopId: number | undefined;

    if (isPaidInvoice) {
      // FI-002: Stripe copies subscription metadata into the invoice's
      // subscription_details snapshot, not necessarily invoice.metadata.
      const parent = event?.data?.object?.parent;
      const snapshotMetadata =
        parent?.type === 'subscription_details'
          ? parent.subscription_details?.metadata ?? {}
          : {};

      const candidates = [
        metadata.shopId,
        metadata.shop_id,
        snapshotMetadata.shopId,
        snapshotMetadata.shop_id,
      ].filter((value) => value !== undefined && value !== null);

      const resolved = candidates.map((value) => {
        if (
          (typeof value !== 'string' && typeof value !== 'number') ||
          String(value).trim().length === 0 ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) <= 0
        ) {
          throw new Error('[stripe.adapter] invalid invoice shopId');
        }
        return Number(value);
      });

      if (new Set(resolved).size > 1) {
        throw new Error('[stripe.adapter] conflicting invoice shopId');
      }

      shopId = resolved[0];
    } else {
      // Preserve existing attribution for non-invoice-paid webhooks.
      const rawShopId = metadata.shopId ?? metadata.shop_id ?? null;
      shopId = rawShopId !== null && !isNaN(Number(rawShopId))
        ? Number(rawShopId)
        : undefined;
    }
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