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
import { getTierConfig, TIER_ORDER, Tier } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { EntitlementRevocationService } from '../../../services/entitlement-revocation.service.js';
import { captureEvent } from '../../../utils/analytics.js';
import { transitionShopSubscription } from '../../../services/billing/subscriptionTransition.service.js';
import { resolveStripeSubscriptionCommercial } from '../../../services/billing/providerPriceResolver.service.js';

// BILL-ENTITLEMENT-01 / P0-B3: the env-derived SEAT_ADDON_PRICE_IDS set that
// used to live here has been removed. It classified items by exclusion
// ("not a seat => it's the base tier"), and because it was built with
// `.filter(Boolean)` an unset seat env var silently turned a real seat line
// into the base tier line. Item classification is now positive and total —
// every line must resolve through the canonical provider-price resolver.

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

  // BILL-ENTITLEMENT-01 / P0-B3: the tier is derived from the Stripe price the
  // merchant actually bought, never from sub.metadata.tier. Metadata is mutable,
  // is NOT rewritten when a merchant switches plan in the Stripe Customer Portal,
  // and is absent on any subscription created outside our own checkout.
  //
  // resolveStripeSubscriptionCommercial fails closed on an unknown price, on zero
  // or multiple base lines, and on any unrecognized line item — there is no
  // metadata fallback and no items[0] fallback.
  const commercial = resolveStripeSubscriptionCommercial(sub);

  const status = sub?.status ?? 'active';

  // SHB-14: mirror SHB-13's Shopify-side contract — resolveTierForShop()
  // reads shop_subscriptions.tier verbatim with no status check, so tier
  // must never stay elevated once Stripe has genuinely given up collecting.
  // 'past_due' is intentionally excluded: Stripe's own dunning/retry grace
  // period applies, entitlements stay live (see handlePaymentFailed.ts).
  // 'canceled' and 'unpaid' are terminal — force starter regardless of
  // what stale metadata.tier still says.
  const TERMINAL_STRIPE_STATUSES = new Set(['canceled', 'unpaid']);
  const tier: Tier = TERMINAL_STRIPE_STATUSES.has(status)
    ? 'starter'
    : commercial.tier;
  const tierConfig = getTierConfig(tier);

  // AUD-C16: subscription items now may include a seat add-on line
  // alongside the base tier line — must not assume index 0 is the
  // base item. extra_seats is derived fresh from Stripe's item list
  // every upsert, so removing seats via the Stripe portal self-corrects
  // on the next webhook without separate remove logic.
  // Base item and seat count both come from the resolver's positive
  // classification, so period boundaries below are read from the line that
  // genuinely IS the tier line rather than from whichever line Stripe listed
  // first. Seats are counted only from lines that resolved as seat add-ons.
  const baseItem = commercial.baseItem;
  const extraSeats = commercial.extraSeats;

  // Interval comes from the price identity, not from the item's plan object.
  const billingInterval = commercial.interval;
  const stripeCustomerId = sub?.customer ?? null;
  const stripeSubscriptionId = sub?.id ?? null;

  // Stripe flexible billing moved period boundaries from the subscription
  // onto each subscription item. Prefer the base tier item while retaining
  // top-level fallbacks for legacy Stripe payloads.
  const currentPeriodStartSeconds =
    baseItem?.current_period_start ?? sub?.current_period_start;
  const currentPeriodEndSeconds =
    baseItem?.current_period_end ?? sub?.current_period_end;
  const currentPeriodStart = currentPeriodStartSeconds
    ? new Date(currentPeriodStartSeconds * 1000)
    : null;
  const currentPeriodEnd = currentPeriodEndSeconds
    ? new Date(currentPeriodEndSeconds * 1000)
    : null;
  const trialEnd = sub?.trial_end ? new Date(sub.trial_end * 1000) : null;

  // ISS-C19: capture the shop's pre-upsert tier so we can detect a
  // downgrade after the upsert overwrites it. A shop with no prior
  // row (brand-new subscription) has nothing to revoke.
  const priorRow = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('tier');
  const priorTier = priorRow?.tier as Tier | undefined;

  // 1. Upsert subscription record — BILL-ENTITLEMENT-01
  //
  // tier + status are entitlement-authoritative and now route through the
  // canonical transition service. The remaining columns are accompanying
  // non-authoritative fields and are written unchanged in the same statement.
  //
  // The billing_provider asymmetry is PRESERVED EXACTLY. The old upsert put
  // billing_provider='stripe' in the INSERT payload but deliberately left it
  // out of the merge list, so a Stripe webhook could establish the stamp on a
  // brand-new row but never overwrite a 'shopify' stamp set at App Store
  // install. Here that is expressed by passing billingProvider ONLY when there
  // is no prior row: an omitted `to` key means "leave this dimension
  // unchanged", which is precisely what excluding it from the merge did.
  await transitionShopSubscription(
    {
      shopId,
      to: {
        tier,
        status,
        ...(priorRow ? {} : { billingProvider: 'stripe' }),
      },
      fields: {
        billing_interval: billingInterval,
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        extra_seats: extraSeats,
        trial_ends_at: trialEnd,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
      },
      source: 'stripe_webhook',
      reason: envelope.eventType,
      actorType: 'stripe',
      actingProvider: 'stripe',
      externalEventId: envelope.eventId,
      idempotencyKey: envelope.eventId,
      occurredAt: envelope.receivedAt,
      // Provider facts that decided this transition, so a metadata/price
      // disagreement is inspectable after the fact. Price IDs and tier names
      // are configuration identifiers, not secrets — no key or token is stored.
      metadata: {
        stripe_base_price_id: commercial.basePriceId,
        price_derived_tier: commercial.tier,
        price_derived_interval: commercial.interval,
        price_derived_currency: commercial.currency,
        metadata_tier: commercial.metadataTier,
        metadata_disagreement: commercial.metadataDisagreement,
        extra_seats: commercial.extraSeats,
      },
    },
    trx
  );

  if (commercial.metadataDisagreement) {
    // Loud, but non-fatal: the price has already decided the tier. This is the
    // signal that a portal-driven or dashboard-driven plan change happened
    // without our metadata being rewritten.
    console.warn('[billing][subscription_upsert] stripe metadata.tier disagrees with purchased price', {
      shopId,
      eventId: envelope.eventId,
      priceDerivedTier: commercial.tier,
      metadataTier: commercial.metadataTier,
      basePriceId: commercial.basePriceId,
    });
  }

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

  // ISS-C19: revoke modules/flags the prior tier granted that the new
  // tier does not. Only real downgrades produce anything to revoke —
  // same tier or an upgrade always yields empty diffs. Mirrors the
  // pattern in trial-expiry.service.ts, the only other place this
  // system revokes entitlements.
  if (priorTier && priorTier !== tier) {
    const priorTierConfig = getTierConfig(priorTier);
    const newModuleSet = new Set(tierConfig.modules);
    const newFlagSet = new Set(tierConfig.flags);
    const modulesToRevoke = priorTierConfig.modules.filter((m) => !newModuleSet.has(m));
    const flagsToRevoke = priorTierConfig.flags.filter((f) => !newFlagSet.has(f));

    if (modulesToRevoke.length > 0 || flagsToRevoke.length > 0) {
      await EntitlementRevocationService.revokeEntitlements({
        shopId,
        scope: {
          modules: modulesToRevoke as string[],
          flags: flagsToRevoke as string[],
        },
        reason: `tier_downgrade:${priorTier}->${tier}`,
      });
      console.log('[billing][subscription_upsert] entitlements revoked on downgrade', {
        shopId,
        priorTier,
        newTier: tier,
        modulesToRevoke,
        flagsToRevoke,
      });
    }
  }

  console.log('[billing][subscription_upsert] complete', { shopId, tier, status,eventId: envelope.eventId });

  /**
   * PH-03 subscription lifecycle analytics.
   * - created => activated
   * - updated => upgraded only when the canonical tier rank increased
   * Same-tier renewals and downgrades must not inflate upgrade metrics.
   */
  const stripeEventType = envelope.eventType;

  if (stripeEventType === 'customer.subscription.created') {
    captureEvent({
      shopId,
      event: 'subscription_activated',
      properties: {
        tier,
        status,
        billing_interval: billingInterval,
      },
    });
  } else if (
    stripeEventType === 'customer.subscription.updated' &&
    priorTier &&
    TIER_ORDER[tier] > TIER_ORDER[priorTier]
  ) {
    captureEvent({
      shopId,
      event: 'subscription_upgraded',
      properties: {
        tier,
        previous_tier: priorTier,
        status,
        billing_interval: billingInterval,
      },
    });
  }
}
