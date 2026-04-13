// apps/backend/src/api/billing/handlers/handlePaymentFailed.ts
//
// Handles: invoice.payment_failed
//
// Responsibility:
//   - Mark shop_subscriptions status as 'past_due'
//   - Does NOT revoke entitlements — grace period is Stripe's responsibility
//   - Ops signal only; dunning is handled by Stripe

import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../webhooks/types.js';

export async function handlePaymentFailed(envelope: WebhookEnvelope): Promise<void> {
  const shopId = envelope.shopId;

  if (!shopId) {
    console.error('[billing][payment_failed] missing shopId', { eventId: envelope.eventId });
    throw new Error('[billing][payment_failed] shopId required');
  }

  const updated = await db('shop_subscriptions')
    .where({ shop_id: shopId })
    .update({
      status: 'past_due',
      updated_at: new Date(),
    });

  if (updated === 0) {
    console.warn('[billing][payment_failed] no subscription row found for shop', { shopId, eventId: envelope.eventId });
    return;
  }

  console.log('[billing][payment_failed] complete', { shopId, eventId: envelope.eventId });
}