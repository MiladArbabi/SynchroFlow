// apps/backend/src/api/billing/handlers/handleSubscriptionDeleted.ts
//
// Handles: customer.subscription.deleted
//
// Responsibility:
//   - Mark shop_subscriptions status as 'canceled'
//   - Does NOT revoke entitlements (handled by separate revocation flow)
//   - Logs loud for ops visibility
//
// ISS-RLS3/4: trx REQUIRED — previously used bare db import, exposed
// to the same RLS-blind pattern confirmed on handleSubscriptionUpsert.ts.
import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../webhooks/types.js';
import { captureEvent } from '../../../utils/analytics.js';
export async function handleSubscriptionDeleted(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const sub = envelope.rawPayload as any;
  const shopId = envelope.shopId;
  if (!shopId) {
    console.error('[billing][subscription_deleted] missing shopId', { eventId: envelope.eventId });
    throw new Error('[billing][subscription_deleted] shopId required');
  }
  const canceledAt = sub?.canceled_at ? new Date(sub.canceled_at * 1000) : new Date();

  // SHB-14: hard delete is unambiguously terminal — force starter here too,
  // since this handler previously left tier untouched entirely, relying on
  // handleSubscriptionUpsert to have already caught it (it hadn't).
  const updated = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .update({
      tier: 'starter',
      status: 'canceled',
      canceled_at: canceledAt,
      updated_at: new Date(),
    });
  if (updated === 0) {
    // Non-fatal: shop may not have a subscription row if never activated
    console.warn('[billing][subscription_deleted] no subscription row found for shop', { shopId, eventId: envelope.eventId });
    return;
  }
  console.log('[billing][subscription_deleted] complete', { shopId, canceledAt, eventId: envelope.eventId });
  /**
   * PH-03: subscription_cancelled — fires when Stripe confirms cancellation.
   * Critical churn signal — pair with paywall_hit and trial_expired
   * in PostHog to understand full churn journey.
   */
  captureEvent({
    shopId,
    event: 'subscription_cancelled',
    properties: {
      canceled_at: canceledAt.toISOString(),
    },
  });
}
