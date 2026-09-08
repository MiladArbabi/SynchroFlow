// apps/backend/src/api/billing/handlers/handlePaymentFailed.ts
//
// Handles: invoice.payment_failed
//
// Responsibility:
//   - Mark shop_subscriptions status as 'past_due'
//   - Does NOT revoke entitlements — grace period is Stripe's responsibility
//   - Ops signal only; dunning is handled by Stripe
//
// ISS-RLS3/4: trx REQUIRED — see handleSubscriptionUpsert.ts header.
import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../webhooks/types.js';
import { captureEvent } from '../../../utils/analytics.js';
import { transitionShopSubscription } from '../../../services/billing/subscriptionTransition.service.js';
export async function handlePaymentFailed(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const shopId = envelope.shopId;
  if (!shopId) {
    console.error('[billing][payment_failed] missing shopId', { eventId: envelope.eventId });
    throw new Error('[billing][payment_failed] shopId required');
  }
  // BILL-ENTITLEMENT-01: status is entitlement-authoritative, so the change
  // goes through the canonical transition service. The pre-existing
  // "no subscription row" behaviour is preserved explicitly — the old UPDATE
  // simply affected zero rows, whereas the service would treat a missing row
  // as a creation. A payment failure must never create a subscription.
  const existing = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('shop_id');
  if (!existing) {
    console.warn('[billing][payment_failed] no subscription row found for shop',{ shopId, eventId: envelope.eventId });
    return;
  }

  await transitionShopSubscription(
    {
      shopId,
      to: { status: 'past_due' },
      source: 'stripe_webhook',
      reason: 'invoice.payment_failed',
      actorType: 'stripe',
      actingProvider: 'stripe',
      externalEventId: envelope.eventId,
      idempotencyKey: envelope.eventId,
      occurredAt: envelope.receivedAt,
    },
    trx
  );
  console.log('[billing][payment_failed] complete', { shopId, eventId: envelope.eventId });
  /**
   * PH-03: payment_failed — fires when Stripe reports a failed invoice.
   * Dunning is handled by Stripe; this event is for PostHog cohort analysis.
   * Pair with subscription_cancelled to measure recovery rate.
   */
  captureEvent({
    shopId,
    event: 'payment_failed',
    properties: {},
  });
}
