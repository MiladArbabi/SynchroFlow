// FILE: apps/backend/src/services/shopify/shopifyUninstallGrace.service.ts
//
// Shopify Uninstall Grace-Period Sweep (SHB-08)
// -----------------------------------------------
// Runs on a schedule. Finds Shopify-billed shops whose paid grace period
// has genuinely lapsed (current_period_end in the past) and downgrades
// them to Starter. Necessary because Shopify sends no webhook exactly at
// period-end — handleAppUninstalled and handleAppSubscriptionUpdate only
// fire at cancellation/uninstall time, when the period may still have
// time remaining.
//
// DB-only by design (mirrors handleAppUninstalled's safety-net check) —
// no live Shopify API call, consistent with the token-revocation risk
// documented there. All the data this worker needs was already captured
// while the token was valid.
//
// HARD RULES:
//   - Per-shop failures are isolated — never crash the cycle
//   - Idempotent: forceDowngradeShopToStarter no-ops if already starter
//
// Mirrors trial-expiry.service.ts's structure and polling pattern.

import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { forceDowngradeShopToStarter } from './forceDowngradeToStarter.service.js';

export async function runShopifyUninstallGraceCycle(): Promise<void> {
  const result = await systemQuery(
    db.raw('SELECT * FROM public.list_expired_shopify_grace_tenants()')
  );
  const expiredShops: Array<{ shop_id: number }> = result.rows;

  for (const row of expiredShops) {
    try {
      await withTenant(row.shop_id, (trx) =>
        forceDowngradeShopToStarter(
          row.shop_id,
          trx,
          'shopify_grace_period_expired'
        )
      );
    } catch (err) {
      console.error('[shopify-uninstall-grace] downgrade failed (isolated)', {
        shopId: row.shop_id,
        err: err instanceof Error ? err.message : err,
      });
    }
  }
}
