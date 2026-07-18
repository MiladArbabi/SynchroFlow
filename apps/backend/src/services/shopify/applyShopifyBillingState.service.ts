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
  await trx('shop_subscriptions')
    .insert({
      shop_id: shopId,
      tier,
      billing_provider: 'shopify',
      status: billingState.status,
      current_period_end: billingState.currentPeriodEnd,
      updated_at: new Date(),
    })
    .onConflict('shop_id')
    .merge([
      'tier',
      'billing_provider',
      'status',
      'current_period_end',
      'updated_at',
    ]);

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
