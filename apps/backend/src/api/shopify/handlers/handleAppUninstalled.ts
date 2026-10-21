// apps/backend/src/api/shopify/handlers/handleAppUninstalled.ts
//
// Handles: app/uninstalled (SHB-08)
//
// Responsibility:
//   1. Atomically hard-fence credential authority and clear ACCESS shadows.
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
import { ShopifyAppService } from '@lasyncro/backend-core/services/shopify-app.service.js';
import { forceDowngradeShopToStarter } from '../../../services/shopify/forceDowngradeToStarter.service.js';

/**
 * GH-979 C owner disconnect: the exact authority Shopify confirmed uninstalled.
 * The webhook passes no pin and keeps its tenant-wide GH-1068 semantics.
 */
export interface AppUninstalledPin {
  installationId: number;
  shopDomain: string;
  /** null pins an installation that has no canonical credential row (legacy bootstrap). */
  credentialGeneration: string | null;
}

/** Returns false only for a pinned call whose authority has moved: nothing is fenced. */
export async function handleAppUninstalled(
  shopId: number,
  trx: Knex.Transaction,
  pin?: AppUninstalledPin,
): Promise<boolean> {
  const now = new Date();

  // 1. Join the webhook transaction/savepoint; do not open an independent transaction.
  if (pin) {
    // Same T2 authority lock as the canonical fence (re-entrant), held through it.
    await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?), ?)',
      ['shopify_admin_credential_rotation', shopId]);
    const current = await trx('shopify_app_installations as installation')
      .leftJoin('shopify_admin_credentials as credential', function joinCredential() {
        this.on('credential.installation_id', '=', 'installation.id')
          .andOn('credential.shop_id', '=', 'installation.shop_id');
      })
      .where('installation.shop_id', shopId)
      .andWhere('installation.id', pin.installationId)
      .andWhere('installation.shop_domain', pin.shopDomain)
      .whereNull('installation.uninstalled_at')
      .first('credential.credential_generation');
    // Never fence a newer installation epoch or credential generation.
    const generation = current?.credential_generation == null ? null : String(current.credential_generation);
    if (!current || generation !== pin.credentialGeneration) return false;
    // shop_domain is globally unique: this fences exactly the pinned installation.
    await ShopifyAppService.hardFenceAppUninstalled(shopId, trx, now, pin.shopDomain);
  } else {
    await ShopifyAppService.hardFenceAppUninstalled(shopId, trx, now);
  }

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
  return true;
}
