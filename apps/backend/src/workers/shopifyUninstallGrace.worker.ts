// FILE: apps/backend/src/workers/shopifyUninstallGrace.worker.ts
//
// Shopify Uninstall Grace-Period Worker (SHB-08)
// -------------------------------------------------
// Polls every 6 hours, downgrading Shopify-billed shops whose paid
// grace period has lapsed. Mirrors trial-expiry.worker.ts exactly.
import { runShopifyUninstallGraceCycle } from '../services/shopify/shopifyUninstallGrace.service.js';

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startShopifyUninstallGraceWorker(): Promise<void> {
  if (running) return;
  running = true;
  console.info('[shopify-uninstall-grace-worker] started');
  while (running) {
    try {
      await runShopifyUninstallGraceCycle();
    } catch (err) {
      console.error('[shopify-uninstall-grace-worker] cycle error', {
        error: err instanceof Error ? err.message : err,
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopShopifyUninstallGraceWorker(): void {
  running = false;
  console.info('[shopify-uninstall-grace-worker] stopped');
}