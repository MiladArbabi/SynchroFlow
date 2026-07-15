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
//
// ISS-RLS4 (CRITICAL FIX): previously opened its own db.transaction()
// with NO tenant context set at all — verified directly that this
// throws "new row violates row-level security policy" on
// shop_subscriptions' strict WITH CHECK policy. Any real Stripe
// customer.subscription.created/updated webhook would have failed
// permanently (Stripe's retries hit the identical failure every time).
// Now uses the router's tenant-scoped trx directly — see
// RLS_blueprint.md §7.

import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../webhooks/types.js';
import { getTierConfig, isValidTier, Tier } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { captureEvent } from '../../../utils/analytics.js';

// AUD-C16: known extra-seat add-on Price IDs, used to separate seat
// line items from the base tier line item on a subscription. Read
// directly from env rather than importing getSeatPriceId, since we
// need the full set to test membership, not a single tier/currency
// lookup.
const SEAT_ADDON_PRICE_IDS = new Set(
  [
    process.env.STRIPE_PRICE_SEAT_ADDON_CORE_USD,
    process.env.STRIPE_PRICE_SEAT_ADDON_CORE_GBP,
    process.env.STRIPE_PRICE_SEAT_ADDON_CORE_EUR,
    process.env.STRIPE_PRICE_SEAT_ADDON_GROWTH_USD,
    process.env.STRIPE_PRICE_SEAT_ADDON_GROWTH_GBP,
    process.env.STRIPE_PRICE_SEAT_ADDON_GROWTH_EUR,
  ].filter(Boolean)
);

export async function handleSubscriptionUpsert(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction
): Promise<void> {
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

  // AUD-C16: subscription items now may include a seat add-on line
  // alongside the base tier line — must not assume index 0 is the
  // base item. extra_seats is derived fresh from Stripe's item list
  // every upsert, so removing seats via the Stripe portal self-corrects
  // on the next webhook without separate remove logic.
  const items = sub?.items?.data ?? [];
  const baseItem = items.find((i: any) => !SEAT_ADDON_PRICE_IDS.has(i?.price?.id)) ?? items[0];
  const extraSeats = items
    .filter((i: any) => SEAT_ADDON_PRICE_IDS.has(i?.price?.id))
    .reduce((sum: number, i: any) => sum + (i?.quantity ?? 0), 0);

  const billingInterval = baseItem?.plan?.interval === 'year' ? 'annual' : 'monthly';
  const stripeCustomerId = sub?.customer ?? null;
  const stripeSubscriptionId = sub?.id ?? null;
  const currentPeriodStart = sub?.current_period_start
    ? new Date(sub.current_period_start * 1000)
    : null;
  const currentPeriodEnd = sub?.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;
  const trialEnd = sub?.trial_end ? new Date(sub.trial_end * 1000) : null;

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
      extra_seats: extraSeats,
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
      'extra_seats',
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

  console.log('[billing][subscription_upsert] complete', { shopId, tier, status,eventId: envelope.eventId });

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
