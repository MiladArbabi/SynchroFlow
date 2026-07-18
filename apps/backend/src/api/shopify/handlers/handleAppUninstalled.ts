// apps/backend/src/api/shopify/handlers/handleAppUninstalled.ts
//
// Handles: app/uninstalled (SHB-08)
//
// Responsibility:
//   1. Mark shopify_app_installations.uninstalled_at.
//   2. DB-only safety-net downgrade check — does NOT call the live
//      Shopify API, since the access token is typically already revoked
//      by Shopify at/near uninstall time. Uses whatever current_period_end
//      is already stored from the last time the token was valid.
//      - If the shop was Shopify-billed, not already Starter, and its
//        stored grace period has already lapsed (or was never set):
//        downgrade immediately.
//      - If still within a stored grace period: leave tier as-is — the
//        shopify-uninstall-grace sweep worker will catch it later,
//        purely from DB state, same as this check.
//   3. app_subscriptions/update may ALSO fire around uninstall and
//      attempt a live reconciliation via applyShopifyBillingState — if
//      the token is already dead by then, that call fails and retries
//      exhaust uselessly against a permanently revoked token. Known,
//      accepted limitation: uninstalled_at is set independently here,
//      and the grace worker still catches the eventual downgrade.
//
// HARD RULES:
//   - Idempotent — safe to run more than once
//   - shopId resolved upstream by WebhookRouter (SHB-16 fix) — trusted here

import type { Knex } from 'knex';
import { forceDowngradeShopToStarter } from '../../../services/shopify/forceDowngradeToStarter.service.js';

export async function handleAppUninstalled(
  shopId: number,
  trx: Knex.Transaction
): Promise<void> {
  const now = new Date();

  // 1. Mark uninstalled — SHB-09: this is the real, actively-consumed
  // column (manualSync.controller.ts gates sync on uninstalled_at IS NULL)
  await trx('shopify_app_installations')
    .where({ shop_id: shopId })
    .update({ uninstalled_at: now, updated_at: now });

  // 2. DB-only safety-net downgrade check
  const subRow = await trx('shop_subscriptions')
    .where({ shop_id: shopId })
    .first('tier', 'current_period_end', 'billing_provider');

  if (subRow && subRow.billing_provider === 'shopify' && subRow.tier !== 'starter') {
    const periodEnd = subRow.current_period_end as Date | null;
    const stillInGrace = periodEnd !== null && new Date(periodEnd).getTime() > now.getTime();

    if (stillInGrace) {
      console.log('[shopify][app_uninstalled] grace period active, deferring to sweep worker', {
        shopId,
        currentPeriodEnd: periodEnd,
      });
    } else {
      await forceDowngradeShopToStarter(shopId, trx, 'app_uninstalled_no_grace_remaining');
    }
  }

  console.log('[shopify][app_uninstalled] complete', { shopId, uninstalledAt: now });
}
