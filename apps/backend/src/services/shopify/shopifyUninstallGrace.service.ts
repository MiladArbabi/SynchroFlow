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

import db from '@lasyncro/backend-core/db.js';
import { forceDowngradeShopToStarter } from './forceDowngradeToStarter.service.js';

// Statuses eligible for grace-period downgrade — must match the mapping
// in shopifyBillingReconciliation.service.ts's GRACE_PERIOD_STATUSES
// (Shopify CANCELLED -> 'canceled', FROZEN -> 'past_due'). ACTIVE shops
// ('active' status) are correctly excluded by this filter.
const GRACE_ELIGIBLE_DB_STATUSES = ['canceled', 'past_due'];

export async function runShopifyUninstallGraceCycle(): Promise<void> {
  const expiredShops = await db('shop_subscriptions')
    .where({ billing_provider: 'shopify' })
    .whereNot({ tier: 'starter' })
    .whereIn('status', GRACE_ELIGIBLE_DB_STATUSES)
    .whereNotNull('current_period_end')
    .where('current_period_end', '<', new Date())
    .select('shop_id');

  for (const row of expiredShops) {
    try {
      await db.transaction(async (trx) => {
        await forceDowngradeShopToStarter(row.shop_id, trx, 'shopify_grace_period_expired');
      });
    } catch (err) {
      console.error('[shopify-uninstall-grace] downgrade failed (isolated)', {
        shopId: row.shop_id,
        err: err instanceof Error ? err.message : err,
      });
    }
  }
}