// S4-5 I4 — supervised Shopify recovery inventory sync worker.
// Cross-tenant discovery lists shops only (0228 SECURITY DEFINER function);
// every credit read/write then runs under that shop's tenant context.
//
// Default OFF: only SHOPIFY_RECOVERY_INVENTORY_SYNC_ENABLED === 'true' enables
// it. Disabled, neither start nor a cycle touches the database or Shopify.
import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { runShopifyRecoveryInventorySyncForShop } from '../services/wms/shopifyRecoveryInventorySync.service.js';

export const SHOPIFY_RECOVERY_INVENTORY_SYNC_FLAG = 'SHOPIFY_RECOVERY_INVENTORY_SYNC_ENABLED';

export function isShopifyRecoveryInventorySyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SHOPIFY_RECOVERY_INVENTORY_SYNC_FLAG] === 'true';
}

const SYNC_INTERVAL_MS = 60 * 1000;
const SLEEP_SLICE_MS = 1000;

let running = false;
let loopPromise: Promise<void> | null = null;
let cycleRunning = false;
let stopRequested = false;
let wakeSleep: (() => void) | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (wakeSleep === resolve) wakeSleep = null;
      resolve();
    }, ms);
    wakeSleep = () => {
      clearTimeout(timeout);
      if (wakeSleep) wakeSleep = null;
      resolve();
    };
  });
}

async function interruptibleSleep(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!stopRequested && Date.now() < deadline) {
    await sleep(Math.min(SLEEP_SLICE_MS, deadline - Date.now()));
  }
}

export async function runShopifyRecoveryInventorySyncCycle(): Promise<void> {
  if (!isShopifyRecoveryInventorySyncEnabled()) return;
  if (cycleRunning) return;
  cycleRunning = true;

  try {
    const result = await systemQuery(
      db.raw('SELECT shop_id FROM public.list_shopify_recovery_inventory_sync_tenants()')
    );
    const candidates: Array<{ shop_id: number }> = result.rows ?? [];

    for (const candidate of candidates) {
      if (stopRequested) break;
      const shopId = Number(candidate.shop_id);
      if (!Number.isInteger(shopId) || shopId <= 0) continue;

      try {
        await runShopifyRecoveryInventorySyncForShop(shopId);
      } catch (err) {
        console.error('[RECOVERY_SYNC_SHOP_FAILED]', {
          shopId,
          error: err instanceof Error ? err.message : err,
        });
      }
    }
  } finally {
    cycleRunning = false;
  }
}

async function runLoop(): Promise<void> {
  while (!stopRequested) {
    await runShopifyRecoveryInventorySyncCycle().catch((err) => {
      console.error('[RECOVERY_SYNC_CYCLE_FAILED]', {
        error: err instanceof Error ? err.message : err,
      });
    });
    await interruptibleSleep(SYNC_INTERVAL_MS);
  }
}

export async function startShopifyRecoveryInventorySyncWorker(): Promise<void> {
  if (!isShopifyRecoveryInventorySyncEnabled()) return;
  if (running) return;

  running = true;
  stopRequested = false;
  loopPromise = runLoop().finally(() => {
    running = false;
    loopPromise = null;
    cycleRunning = false;
  });
}

export async function stopShopifyRecoveryInventorySyncWorker(): Promise<void> {
  stopRequested = true;
  wakeSleep?.();
  if (loopPromise) {
    await loopPromise;
  }
}
