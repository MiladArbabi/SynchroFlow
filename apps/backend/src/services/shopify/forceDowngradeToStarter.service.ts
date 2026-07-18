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
import { EntitlementRevocationService } from '../entitlement-revocation.service.js';

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

  await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .update({
      tier: 'starter',
      status: 'canceled',
      updated_at: new Date(),
    });

  const starterConfig = getTierConfig('starter');
  const priorTierConfig = getTierConfig(priorTier);
  const starterModuleSet = new Set(starterConfig.modules);
  const starterFlagSet = new Set(starterConfig.flags);
  const modulesToRevoke = priorTierConfig.modules.filter((m) => !starterModuleSet.has(m));
  const flagsToRevoke = priorTierConfig.flags.filter((f) => !starterFlagSet.has(f));

  if (modulesToRevoke.length > 0 || flagsToRevoke.length > 0) {
    await EntitlementRevocationService.revokeEntitlements({
      shopId,
      scope: {
        modules: modulesToRevoke as string[],
        flags: flagsToRevoke as string[],
      },
      reason,
    });
  }

  console.log('[shopify][force_downgrade_to_starter] complete', {
    shopId,
    priorTier,
    reason,
    modulesToRevoke,
    flagsToRevoke,
  });
}
