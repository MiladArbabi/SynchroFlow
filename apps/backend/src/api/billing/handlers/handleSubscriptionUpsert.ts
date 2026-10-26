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
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { EntitlementRevocationService } from '../../../services/entitlement-revocation.service.js';
import { captureEvent } from '../../../utils/analytics.js';
import { transitionShopSubscription } from '../../../services/billing/subscriptionTransition.service.js';
import { resolveStripeSubscriptionCommercial } from '../../../services/billing/providerPriceResolver.service.js';
import { requireStripeSubscriptionAuthority } from '../../../services/billing/stripeSubscriptionAuthority.service.js';

// BILL-ENTITLEMENT-01 / P0-B3: the env-derived SEAT_ADDON_PRICE_IDS set that
// used to live here has been removed. It classified items by exclusion
// ("not a seat => it's the base tier"), and because it was built with
// `.filter(Boolean)` an unset seat env var silently turned a real seat line
// into the base tier line. Item classification is now positive and total —
// every line must resolve through the canonical provider-price resolver.

export async function handleSubscriptionUpsert(
  envelope: WebhookEnvelope,
  trx: Knex.Transaction,
  attribution?: unknown
): Promise<void> {
  const authority = requireStripeSubscriptionAuthority(envelope, attribution);
  if (authority.ignored) return;
  const sub = authority.subscription! as NonNullable<typeof authority.subscription> & {
    current_period_start?: number;
    current_period_end?: number;
  };
  const shopId = envelope.shopId;

  if (!shopId) {
    console.error('[billing][subscription_upsert] missing shopId', { eventId: envelope.eventId });
    throw new Error('[billing][subscription_upsert] shopId required');
  }

  const rawStatus = sub.status;
  const trialValid = rawStatus === 'trialing' && Number.isFinite(sub.trial_end) &&
    sub.trial_end! * 1000 > Date.now();
  const eligible = rawStatus === 'active' || rawStatus === 'past_due' || trialValid;
  const status = rawStatus === 'canceled' ? 'canceled' : rawStatus === 'active' ? 'active' :
    rawStatus === 'past_due' ? 'past_due' : trialValid ? 'trialing' : 'unpaid';

  // BILL-ENTITLEMENT-01 / P0-B3: the tier is derived from the Stripe price the
  // merchant actually bought, never from sub.metadata.tier. Metadata is mutable,
  // is NOT rewritten when a merchant switches plan in the Stripe Customer Portal,
  // and is absent on any subscription created outside our own checkout.
  //
  // resolveStripeSubscriptionCommercial fails closed on an unknown price, on zero
  // or multiple base lines, and on any unrecognized line item — there is no
  // metadata fallback and no items[0] fallback.
  // An authoritative ineligible state must revoke paid access even if its old
  // price line is no longer classifiable. Eligible grants remain strict and
  // fail closed through the canonical resolver.
  const commercial = eligible ? resolveStripeSubscriptionCommercial(sub) : null;

  // W1-A-D7: keep the five canonical statuses. Ineligible provider states
  // normalize to unpaid/Starter; past_due keeps existing dunning access.
  const tier: Tier = commercial?.tier ?? 'starter';
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
  const baseItem = commercial?.baseItem;
  const extraSeats = commercial?.extraSeats ?? 0;

  // Interval comes from the price identity, not from the item's plan object.
  const billingInterval = commercial?.interval ?? null;
  const stripeCustomerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
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
  const transition = await transitionShopSubscription(
    {
      shopId,
      to: {
        tier,
        status,
        billingProvider: 'stripe',
      },
      fields: {
        ...(commercial ? {
          billing_interval: billingInterval,
          extra_seats: extraSeats,
          current_period_start: currentPeriodStart,
          current_period_end: currentPeriodEnd,
        } : {}),
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        trial_ends_at: trialEnd,
      },
      source: 'stripe_webhook',
      reason: envelope.eventType,
      actorType: 'stripe',
      actingProvider: 'stripe',
      expectedCurrent: authority.expectedCurrent,
      externalEventId: envelope.eventId,
      idempotencyKey: envelope.eventId,
      occurredAt: envelope.receivedAt,
      // Provider facts that decided this transition, so a metadata/price
      // disagreement is inspectable after the fact. Price IDs and tier names
      // are configuration identifiers, not secrets — no key or token is stored.
      metadata: {
        stripe_base_price_id: commercial?.basePriceId ?? null,
        price_derived_tier: commercial?.tier ?? null,
        price_derived_interval: commercial?.interval ?? null,
        price_derived_currency: commercial?.currency ?? null,
        metadata_tier: commercial?.metadataTier ?? null,
        metadata_disagreement: commercial?.metadataDisagreement ?? false,
        extra_seats: commercial?.extraSeats ?? 0,
        stripe_raw_status: rawStatus,
      },
    },
    trx
  );
  if (!transition.preconditionMatched || transition.duplicate) return;
  const priorTier = transition.from?.tier as Tier | undefined;

  if (commercial?.metadataDisagreement) {
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
  const tierModules = [...modulesForTier(tier)];
  const tierFlags = [...flagsForTier(tier)];

  const moduleRows = tierModules.map((moduleKey) => ({
    shop_id: shopId,
    module_key: moduleKey,
    flag_key: null as string | null,
    source: `tier:${tier}`,
  }));

  const flagRows = tierFlags.map((flagKey) => ({
    shop_id: shopId,
    module_key: flagKey.split('.')[0],
    flag_key: flagKey,
    source: `tier:${tier}`,
  }));

  if (transition.applied) {
    await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);
  }

  // ISS-C19: revoke modules/flags the prior tier granted that the new
  // tier does not. Only real downgrades produce anything to revoke —
  // same tier or an upgrade always yields empty diffs. Mirrors the
  // pattern in trial-expiry.service.ts, the only other place this
  // system revokes entitlements.
  if (priorTier && priorTier !== tier) {
    const priorModules = [...modulesForTier(priorTier)];
    const priorFlags = [...flagsForTier(priorTier)];
    const newModuleSet = new Set(tierModules);
    const newFlagSet = new Set(tierFlags);
    const modulesToRevoke = priorModules.filter((m) => !newModuleSet.has(m));
    const flagsToRevoke = priorFlags.filter((f) => !newFlagSet.has(f));

    if (modulesToRevoke.length > 0 || flagsToRevoke.length > 0) {
      await EntitlementRevocationService.revokeEntitlements({
        shopId,
        scope: {
          modules: modulesToRevoke as string[],
          flags: flagsToRevoke as string[],
        },
        reason: `tier_downgrade:${priorTier}->${tier}`,
        planOnly: true,
      }, trx);
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
