// apps/backend/src/services/shopify/forceDowngradeToStarter.service.ts
//
// DB-only forced downgrade to Starter (SHB-08)
// -----------------------------------------------
// Used when we must downgrade a shop WITHOUT calling Shopify's live API —
// specifically, uninstall processing, where the stored access token may
// already be revoked by Shopify. Reads only what's already in
// shop_subscriptions from the last time the token was valid.
//
// Also reused by the shopify-uninstall-grace sweep worker, which is
// DB-only by design (mirrors trial-expiry.service.ts's pattern of
// polling shop_subscriptions directly rather than calling out per shop).
//
// Idempotent: no-op if the shop is already on Starter.

import type { Knex } from 'knex';
import { getTierConfig, Tier } from '@lasyncro/backend-core/config/tiers.js';
import { modulesForTier, flagsForTier } from '@lasyncro/commercial-policy';
import { EntitlementRevocationService } from '../entitlement-revocation.service.js';
import { transitionShopSubscription } from '../billing/subscriptionTransition.service.js';

export async function forceDowngradeShopToStarter(
  shopId: number,
  trx: Knex.Transaction,
  reason: string
): Promise<void> {
  const priorRow = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('tier');

  const priorTier = priorRow?.tier as Tier | undefined;

  if (!priorTier || priorTier === 'starter') {
    return; // already starter or no subscription row — nothing to do
  }

  // BILL-ENTITLEMENT-01: tier + status are entitlement-authoritative.
  // The starter + canceled semantics are preserved verbatim — this path
  // deliberately records 'canceled' where trial expiry records 'active',
  // and the ledger does not normalize that difference.
  //
  // The existing early return above already guarantees a subscription row
  // exists, so this can never become an unintended creation. `reason` is the
  // caller-supplied cause ('app_uninstalled_no_grace_remaining' or
  // 'shopify_grace_period_expired') and is recorded as-is.
  const transition = await transitionShopSubscription(
    {
      shopId,
      to: { tier: 'starter', status: 'canceled' },
      source: 'shopify_force_downgrade',
      reason,
      actorType: 'system',
      // P0-B3: both call sites are Shopify-scoped by construction —
      // handleAppUninstalled gates on billing_provider === 'shopify', and the
      // grace worker iterates list_expired_shopify_grace_tenants(). Declaring
      // the acting provider therefore changes no behaviour and closes the path
      // to a foreign-provider downgrade.
      actingProvider: 'shopify',
    },
    trx
  );
  if (!transition.applied || !transition.preconditionMatched || transition.duplicate) return;

  const priorModules = [...modulesForTier(transition.from!.tier as Tier)];
  const priorFlags = [...flagsForTier(transition.from!.tier as Tier)];
  const starterModuleSet = modulesForTier('starter');
  const starterFlagSet = flagsForTier('starter');
  const modulesToRevoke = priorModules.filter((m) => !starterModuleSet.has(m));
  const flagsToRevoke = priorFlags.filter((f) => !starterFlagSet.has(f));

  if (modulesToRevoke.length > 0 || flagsToRevoke.length > 0) {
    await EntitlementRevocationService.revokeEntitlements({
      shopId,
      scope: {
        modules: modulesToRevoke as string[],
        flags: flagsToRevoke as string[],
      },
      reason,
      planOnly: true,
    }, trx);
  }

  console.log('[shopify][force_downgrade_to_starter] complete', {
    shopId,
    priorTier,
    reason,
    modulesToRevoke,
    flagsToRevoke,
  });
}
