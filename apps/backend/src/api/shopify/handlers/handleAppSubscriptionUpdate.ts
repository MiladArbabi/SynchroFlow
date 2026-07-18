import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../webhooks/types.js';
import { applyShopifyBillingState } from '../../../services/shopify/applyShopifyBillingState.service.js';
import { captureEvent } from '../../../utils/analytics.js';

export async function handleAppSubscriptionUpdate(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
  const shopId = envelope.shopId;

  if (!shopId) {
    console.error('[shopify][app_subscription_update] missing shopId', { eventId: envelope.eventId });
    throw new Error('[shopify][app_subscription_update] shopId required');
  }

  const billingState = await applyShopifyBillingState(shopId, trx);

  console.log('[shopify][app_subscription_update] complete', {
    shopId,
    tier: billingState.tier,
    status: billingState.status,
    isEntitled: billingState.isEntitled,
    eventId: envelope.eventId,
  });

  captureEvent({
    shopId,
    event: billingState.isEntitled ? 'subscription_activated' : 'subscription_canceled',
    properties: {
      tier: billingState.tier,
      status: billingState.status,
      billing_provider: 'shopify',
    },
  });
}