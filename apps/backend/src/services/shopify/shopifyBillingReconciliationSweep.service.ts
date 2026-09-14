// FILE: apps/backend/src/services/shopify/shopifyBillingReconciliationSweep.service.ts
//
// Shopify Billing Reconciliation Sweep (BILL-20)
// -----------------------------------------------
// Runs on a schedule. Partner API activeSubscription is provider truth for
// Shopify App Pricing. Redirect reconciliation is the immediate path after a
// merchant returns from Shopify's hosted pricing page; this sweep is the
// durability/fallback path for any missed redirect, webhook, or transient
// provider event.
//
// For every Shopify-billed shop, this calls applyShopifyBillingState, which
// fetches live billing state from Partner API activeSubscription and reconciles
// shop_subscriptions + entitlements to match. Idempotent by construction (an
// already-correct shop is simply re-written to the same values), so running
// this on a schedule is safe even when nothing has actually changed.
//
// Unlike shopifyUninstallGrace.service.ts (deliberately DB-only, since it
// targets shops that may have already revoked/rotated their access token
// on uninstall), this sweep makes a LIVE Shopify API call per shop, since
// it targets shops presumed to still be installed and paying. Cost scales
// with total Shopify-billed shop count — fine at current scale; revisit
// (batching/staggering/skip-recently-reconciled) once shop volume grows.
//
// HARD RULES:
//   - Per-shop failures are isolated — never crash the cycle
//   - Idempotent: applyShopifyBillingState safely re-applies unchanged state
//
// Mirrors shopifyUninstallGrace.service.ts's structure and polling pattern.

import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { applyShopifyBillingState } from './applyShopifyBillingState.service.js';

export async function runShopifyBillingReconciliationCycle(): Promise<void> {
  const result = await systemQuery(
    db.raw('SELECT * FROM public.list_shopify_billed_tenants()')
  );
  const shopifyBilledShops: Array<{ shop_id: number }> = result.rows;

  for (const row of shopifyBilledShops) {
    try {
      await withTenant(row.shop_id, (trx) =>
        applyShopifyBillingState(row.shop_id, trx)
      );
    } catch (err) {
      console.error('[shopify-billing-reconciliation-sweep] reconcile failed (isolated)', {
        shopId: row.shop_id,
        err: err instanceof Error ? err.message : err,
      });
    }
  }
}
