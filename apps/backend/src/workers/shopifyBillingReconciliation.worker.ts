// FILE: apps/backend/src/workers/shopifyBillingReconciliation.worker.ts
//
// Shopify Billing Reconciliation Worker (BILL-20)
// -------------------------------------------------
// Polls every 6 hours, reconciling every Shopify-billed shop's
// shop_subscriptions/entitlements against Shopify's live billing state.
// Fallback for missed app_subscriptions/update webhook deliveries.
// Mirrors shopifyUninstallGrace.worker.ts exactly.

import { runShopifyBillingReconciliationCycle } from '../services/shopify/shopifyBillingReconciliationSweep.service.js';

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startShopifyBillingReconciliationWorker(): Promise<void> {
  if (running) return;
  running = true;
  console.info('[shopify-billing-reconciliation-worker] started');
  while (running) {
    try {
      await runShopifyBillingReconciliationCycle();
    } catch (err) {
      console.error('[shopify-billing-reconciliation-worker] cycle error', {
        error: err instanceof Error ? err.message : err,
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopShopifyBillingReconciliationWorker(): void {
  running = false;
  console.info('[shopify-billing-reconciliation-worker] stopped');
}