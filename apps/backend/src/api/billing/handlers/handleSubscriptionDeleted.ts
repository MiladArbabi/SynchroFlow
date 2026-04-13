// apps/backend/src/api/billing/handlers/handleSubscriptionDeleted.ts
//
// Handles: customer.subscription.deleted
//
// Responsibility:
//   - Mark shop_subscriptions status as 'canceled'
//   - Does NOT revoke entitlements (handled by separate revocation flow)
//   - Logs loud for ops visibility

import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../webhooks/types.js';

export async function handleSubscriptionDeleted(envelope: WebhookEnvelope): Promise<void> {
  const sub = envelope.rawPayload as any;
  const shopId = envelope.shopId;

  if (!shopId) {
    console.error('[billing][subscription_deleted] missing shopId', { eventId: envelope.eventId });
    throw new Error('[billing][subscription_deleted] shopId required');
  }

  const canceledAt = sub?.canceled_at ? new Date(sub.canceled_at * 1000) : new Date();

  const updated = await db('shop_subscriptions')
    .where({ shop_id: shopId })
    .update({
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
}