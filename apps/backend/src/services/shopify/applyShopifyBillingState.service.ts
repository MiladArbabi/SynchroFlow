// apps/backend/src/services/shopify/applyShopifyBillingState.service.ts
//
// Shopify Billing State Application (SHB-01, SHB-08)
// -----------------------------------------------------
// Applies the canonical Shopify App Pricing state resolved from Partner API
// activeSubscription. Redirect reconciliation, scheduled durability sweeps,
// and legacy/secondary webhook paths all route through this boundary rather
// than writing shop_subscriptions or entitlements directly.
//
// Single source of truth for "given a shop, make shop_subscriptions and
// entitlements match Shopify's live billing state right now." Both
// callers own their own logging/analytics — this function only mutates
// state and returns the resolved ShopifyBillingState for that purpose.

import type { Knex } from 'knex';
import { getTierConfig, Tier } from '@lasyncro/backend-core/config/tiers.js';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { EntitlementRevocationService } from '../entitlement-revocation.service.js';
import { fetchShopifyBillingState, ShopifyBillingState } from './shopifyBillingReconciliation.service.js';
import { transitionShopSubscription } from '../billing/subscriptionTransition.service.js';

export async function applyShopifyBillingState(
  shopId: number,
  trx: Knex.Transaction
): Promise<ShopifyBillingState> {
  const billingState = await fetchShopifyBillingState(shopId);

  // Prior state for downgrade-diff revocation (mirrors ISS-C19) AND for the
  // GH-1132 local-trial-preservation check below.
  const priorRow = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('tier', 'status', 'billing_provider', 'trial_ends_at');
  const priorTier = priorRow?.tier as Tier | undefined;

  // GH-1132 — a null Partner commercial plan must not revoke a still-valid
  // local, app-granted Shopify Growth onboarding trial. Provider fact
  // (billingState, normalized starter/canceled/planHandle=null when Partner
  // reports no activeSubscription — see
  // normalizePartnerActiveSubscriptionToBillingState) and effective
  // onboarding access are intentionally distinct during this trial: a null
  // Partner subscription is the EXPECTED state for a merchant who has not
  // yet purchased a real Shopify App Pricing plan, not evidence the trial
  // should be revoked. This guard runs on every caller of this function
  // (OAuth callback, webhooks, the periodic reconciliation sweep) since it
  // sits at the single canonical entry point.
  const now = new Date();
  const hasValidLocalGrowthTrial =
    billingState.planHandle == null &&
    priorRow?.billing_provider === 'shopify' &&
    priorRow?.tier === 'growth' &&
    priorRow?.status === 'trialing' &&
    priorRow?.trial_ends_at != null &&
    new Date(priorRow.trial_ends_at) > now;

  if (hasValidLocalGrowthTrial) {
    console.log('[shopify][billing_state_applied] preserved valid local Growth trial', {
      shopId,
      trialEndsAt: priorRow!.trial_ends_at,
    });
    return billingState;
  }

  const tier = billingState.tier;
  const tierModules = [...modulesForTier(tier)];
  const tierFlags = [...flagsForTier(tier)];

  // 1. Upsert subscription record — billing_provider explicitly stamped (SHB-02)
  //
  // BILL-ENTITLEMENT-01: tier, status and billing_provider are all
  // entitlement-authoritative and now route through the canonical transition
  // service. Unlike the Stripe handler, billing_provider WAS in this upsert's
  // merge list and is therefore always asserted here — a shop reconciled
  // against Shopify's live billing state is, by definition, Shopify-billed.
  // current_period_end remains an accompanying non-authoritative field.
  // Partner API omission is not evidence that an already-known billing boundary
  // disappeared, so a null provider value must not erase the stored boundary.
  //
  // No externalEventId/idempotencyKey: this function is called by redirect
  // reconciliation, the periodic reconciliation sweep, and legacy/secondary
  // webhook paths, and its own signature carries no provider event id. The
  // sweep must stay free to record every genuine state change it observes, so
  // no key is invented here.
  await transitionShopSubscription(
    {
      shopId,
      to: { tier, status: billingState.status, billingProvider: 'shopify' },
      fields: {
        ...(billingState.currentPeriodEnd === null
          ? {}
          : { current_period_end: billingState.currentPeriodEnd }),
        // GH-1132 — this line only runs once the local-trial-preservation
        // check above has already decided NOT to preserve a trial (real
        // Shopify plan superseding it, or the trial itself has expired).
        // Either way a previously-set trial_ends_at must not survive as a
        // stale future date once we're writing real provider-derived state.
        ...(priorRow?.trial_ends_at != null ? { trial_ends_at: null } : {}),
      },
      source: 'shopify_billing_reconciliation',
      reason: 'shopify_billing_state_applied',
      actorType: 'shopify',
      actingProvider: 'shopify',
      // P0-B3: the provider facts that decided this tier. planHandle is the
      // authoritative key; name/price/interval are cross-check context. All are
      // provider configuration identifiers, not secrets.
      metadata: {
        shopify_plan_handle: billingState.planHandle,
        shopify_subscription_id: billingState.shopifySubscriptionId,
        shopify_display_name: billingState.shopifySubscriptionName,
        shopify_price_amount: billingState.price?.amount ?? null,
        shopify_price_currency: billingState.price?.currencyCode ?? null,
        shopify_interval: billingState.interval,
        shopify_is_entitled: billingState.isEntitled,
      },
    },
    trx
  );

  // 2. Re-seed entitlements from tier constants (additive only)
  const moduleRows = tierModules.map((moduleKey) => ({
    shop_id: shopId,
    module_key: moduleKey,
    flag_key: null as string | null,
    source: `shopify_billing:${tier}`,
  }));

  const flagRows = tierFlags.map((flagKey) => ({
    shop_id: shopId,
    module_key: flagKey.split('.')[0],
    flag_key: flagKey,
    source: `shopify_billing:${tier}`,
  }));

  await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);

  // 3. Revoke modules/flags the prior tier granted that the new tier does not.
  // Covers both real tier downgrades AND SHB-13 forced-starter on cancellation.
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
        reason: `shopify_billing_change:${priorTier}->${tier}:${billingState.status}`,
      });
      console.log('[shopify][billing_state_applied] entitlements revoked', {
        shopId,
        priorTier,
        newTier: tier,
        shopifyStatus: billingState.status,
        modulesToRevoke,
        flagsToRevoke,
      });
    }
  }

  return billingState;
}
