// apps/backend/src/api/billing/handlers/handleSubscriptionUpsert.ts
//
// Handles: customer.subscription.created, customer.subscription.updated
//
// Responsibility:
//   1. Upsert shop_subscriptions row from Stripe subscription object
//   2. Re-seed shop_module_entitlements from tier constants
//
// HARD RULES:
//   - Idempotent (upsert, not insert)
//   - Never revokes entitlements directly — uses EntitlementsService
//   - shopId MUST be resolved from metadata; fail loud if missing

import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../webhooks/types.js';
import { getTierConfig, isValidTier, Tier } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { captureEvent } from '../../../utils/analytics.js';

export async function handleSubscriptionUpsert(envelope: WebhookEnvelope): Promise<void> {
  const sub = envelope.rawPayload as any;
  const shopId = envelope.shopId;

  if (!shopId) {
    console.error('[billing][subscription_upsert] missing shopId', { eventId: envelope.eventId });
    throw new Error('[billing][subscription_upsert] shopId required');
  }

  const rawTier = sub?.metadata?.tier;
  if (!isValidTier(rawTier)) {
    console.error('[billing][subscription_upsert] invalid or missing tier in metadata', {
      eventId: envelope.eventId,
      shopId,
      rawTier,
    });
    throw new Error(`[billing][subscription_upsert] invalid tier: "${rawTier}"`);
  }

  const tier = rawTier as Tier;
  const tierConfig = getTierConfig(tier);

  const status = sub?.status ?? 'active';
  const billingInterval = sub?.items?.data?.[0]?.plan?.interval === 'year' ? 'annual' : 'monthly';
  const stripeCustomerId = sub?.customer ?? null;
  const stripeSubscriptionId = sub?.id ?? null;
  const currentPeriodStart = sub?.current_period_start
    ? new Date(sub.current_period_start * 1000)
    : null;
  const currentPeriodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;
  const trialEnd = sub?.trial_end ? new Date(sub.trial_end * 1000) : null;

  await db.transaction(async (trx) => {
    // 1. Upsert subscription record
    await trx('shop_subscriptions')
      .insert({
        shop_id: shopId,
        tier,
        billing_interval: billingInterval,
        billing_provider: 'stripe',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        status,
        trial_ends_at: trialEnd,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        updated_at: new Date(),
      })
      .onConflict('shop_id')
      .merge([
        'tier',
        'billing_interval',
        'stripe_customer_id',
        'stripe_subscription_id',
        'status',
        'trial_ends_at',
        'current_period_start',
        'current_period_end',
        'updated_at',
        // billing_provider intentionally excluded — Stripe webhook must never
        // overwrite a 'shopify' provider stamp set at App Store install.
      ]);

    // 2. Re-seed entitlements from tier constants
    // Additive only — EntitlementsService never revokes
    const moduleRows = tierConfig.modules.map((moduleKey) => ({
      shop_id: shopId,
      module_key: moduleKey,
      flag_key: null as string | null,
      source: `tier:${tier}`,
    }));

    const flagRows = tierConfig.flags.map((flagKey) => ({
      shop_id: shopId,
      module_key: flagKey.split('.')[0],
      flag_key: flagKey,
      source: `tier:${tier}`,
    }));

    await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);
  });

  console.log('[billing][subscription_upsert] complete', { shopId, tier, status, eventId: envelope.eventId });

  /**
   * PH-03: subscription_activated or subscription_upgraded.
   * Fires after Stripe confirms a paid subscription is live.
   * 'created' = new paid subscription, 'updated' = tier change or renewal.
   */
  const stripeEventType = envelope.eventType;
  captureEvent({
    shopId,
    event: stripeEventType === 'customer.subscription.created'
      ? 'subscription_activated'
      : 'subscription_upgraded',
    properties: {
      tier,
      status,
      billing_interval: billingInterval,
    },
  });
}