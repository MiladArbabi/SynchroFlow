// apps/backend/src/services/shopify/applyShopifyBillingState.service.ts
//
// Shopify Billing State Application (SHB-01, SHB-08)
// -----------------------------------------------------
// Extracted from handleAppSubscriptionUpdate so the same logic can be
// safely reused by handleAppUninstalled as a fallback path — Shopify
// gives no hard guarantee that app_subscriptions/update fires alongside
// every app/uninstalled event (e.g. a free-tier shop with no
// subscription to cancel), so uninstall must be able to independently
// reconcile billing state rather than assume the other webhook covers it.
//
// Single source of truth for "given a shop, make shop_subscriptions and
// entitlements match Shopify's live billing state right now." Both
// callers own their own logging/analytics — this function only mutates
// state and returns the resolved ShopifyBillingState for that purpose.

import type { Knex } from 'knex';
import { getTierConfig, Tier } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { EntitlementRevocationService } from '../entitlement-revocation.service.js';
import { fetchShopifyBillingState, ShopifyBillingState } from './shopifyBillingReconciliation.service.js';
import { transitionShopSubscription } from '../billing/subscriptionTransition.service.js';

export async function applyShopifyBillingState(
  shopId: number,
  trx: Knex.Transaction
): Promise<ShopifyBillingState> {
  const billingState = await fetchShopifyBillingState(shopId);
  const tier = billingState.tier;
  const tierConfig = getTierConfig(tier);

  // Prior tier for downgrade-diff revocation (mirrors ISS-C19)
  const priorRow = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('tier');
  const priorTier = priorRow?.tier as Tier | undefined;

  // 1. Upsert subscription record — billing_provider explicitly stamped (SHB-02)
  //
  // BILL-ENTITLEMENT-01: tier, status and billing_provider are all
  // entitlement-authoritative and now route through the canonical transition
  // service. Unlike the Stripe handler, billing_provider WAS in this upsert's
  // merge list and is therefore always asserted here — a shop reconciled
  // against Shopify's live billing state is, by definition, Shopify-billed.
  // current_period_end remains an accompanying non-authoritative field.
  //
  // No externalEventId/idempotencyKey: this function is called both by the
  // app_subscription_update webhook and by the periodic reconciliation sweep,
  // and its own signature carries no provider event id. The sweep must stay
  // free to record every genuine state change it observes, so no key is
  // invented here.
  await transitionShopSubscription(
    {
      shopId,
      to: { tier, status: billingState.status, billingProvider: 'shopify' },
      fields: { current_period_end: billingState.currentPeriodEnd },
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
  const moduleRows = tierConfig.modules.map((moduleKey) => ({
    shop_id: shopId,
    module_key: moduleKey,
    flag_key: null as string | null,
    source: `shopify_billing:${tier}`,
  }));

  const flagRows = tierConfig.flags.map((flagKey) => ({
    shop_id: shopId,
    module_key: flagKey.split('.')[0],
    flag_key: flagKey,
    source: `shopify_billing:${tier}`,
  }));

  await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);

  // 3. Revoke modules/flags the prior tier granted that the new tier does not.
  // Covers both real tier downgrades AND SHB-13 forced-starter on cancellation.
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
