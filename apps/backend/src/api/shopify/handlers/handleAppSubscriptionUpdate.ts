// apps/backend/src/api/shopify/handlers/handleAppSubscriptionUpdate.ts
//
// Handles: app_subscriptions/update (SHB-01, SHB-07)
//
// Responsibility:
//   1. Treat the webhook as a trigger only — fetch authoritative state
//      via fetchShopifyBillingState (Active Subscription API), not the
//      webhook payload itself. Self-heals missed/out-of-order webhooks.
//   2. Upsert shop_subscriptions with billing_provider: 'shopify'
//      (SHB-02: provider is explicitly stamped, never left to default).
//   3. Re-seed entitlements from tier constants (mirrors
//      handleSubscriptionUpsert's additive seed).
//   4. SHB-13: on any non-ACTIVE Shopify status, tier is forced to
//      'starter' by fetchShopifyBillingState — revoke the diff between
//      prior tier and 'starter', same pattern as ISS-C19's downgrade path.
//
// HARD RULES:
//   - Idempotent (upsert, not insert)
//   - Never revokes entitlements directly — uses EntitlementRevocationService
//   - shopId resolved upstream by WebhookRouter before this handler runs
//     (see webhookRouter.ts SHOP RESOLUTION block) — trusted here.

import type { Knex } from 'knex';
import { WebhookEnvelope } from '../../webhooks/types.js';
import { getTierConfig, Tier } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { EntitlementRevocationService } from '../../../services/entitlement-revocation.service.js';
import { fetchShopifyBillingState } from '../../../services/shopify/shopifyBillingReconciliation.service.js';
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
      updated_at: new Date(),
    })
    .onConflict('shop_id')
    .merge([
      'tier',
      'billing_provider',
      'status',
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
      console.log('[shopify][app_subscription_update] entitlements revoked', {
        shopId,
        priorTier,
        newTier: tier,
        shopifyStatus: billingState.status,
        modulesToRevoke,
        flagsToRevoke,
      });
    }
  }

  console.log('[shopify][app_subscription_update] complete', {
    shopId,
    tier,
    status: billingState.status,
    isEntitled: billingState.isEntitled,
    eventId: envelope.eventId,
  });

  captureEvent({
    shopId,
    event: billingState.isEntitled ? 'subscription_activated' : 'subscription_canceled',
    properties: {
      tier,
      status: billingState.status,
      billing_provider: 'shopify',
    },
  });
}
