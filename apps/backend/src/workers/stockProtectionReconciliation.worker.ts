import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { resolveTierForShop } from '@lasyncro/backend-core/services/shop-resolution.service.js';
import {
  CAPABILITY_REQUIREMENTS,
  evaluateAccess,
  isValidTier,
  standardContextForTier,
} from '@lasyncro/commercial-policy';
import { enqueueShopSnapshotJob } from '../services/shop-snapshot/enqueueShopSnapshotJob.js';

const RECONCILIATION_INTERVAL_MS = 15 * 60 * 1000;
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

async function runCycle(): Promise<void> {
  if (cycleRunning) return;
  cycleRunning = true;

  try {
    const result = await systemQuery(
      db.raw('SELECT shop_id FROM public.list_stock_protection_reconciliation_tenants()')
    );
    const candidates: Array<{ shop_id: number }> = result.rows ?? [];

    for (const candidate of candidates) {
      const shopId = Number(candidate.shop_id);
      if (!Number.isInteger(shopId) || shopId <= 0) continue;

      try {
        const rawTier = await resolveTierForShop(shopId);
        if (!isValidTier(rawTier)) {
          console.warn('[STOCK_PROTECTION_RECONCILIATION_TIER_INVALID]', {
            shopId,
            tier: rawTier,
          });
          continue;
        }

        const decision = evaluateAccess(
          CAPABILITY_REQUIREMENTS['demand.forecasting'],
          standardContextForTier(rawTier)
        );

        if (!decision.allowed) continue;

        await withTenant(shopId, (trx) =>
          enqueueShopSnapshotJob(trx, shopId)
        );
      } catch (err) {
        console.error('[STOCK_PROTECTION_RECONCILIATION_SHOP_FAILED]', {
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
    await runCycle().catch((err) => {
      console.error('[STOCK_PROTECTION_RECONCILIATION_CYCLE_FAILED]', {
        error: err instanceof Error ? err.message : err,
      });
    });
    await interruptibleSleep(RECONCILIATION_INTERVAL_MS);
  }
}

export async function startStockProtectionReconciliationWorker(): Promise<void> {
  if (running) return;

  running = true;
  stopRequested = false;
  loopPromise = runLoop().finally(() => {
    running = false;
    loopPromise = null;
    cycleRunning = false;
  });
}

export async function stopStockProtectionReconciliationWorker(): Promise<void> {
  stopRequested = true;
  wakeSleep?.();
  if (loopPromise) {
    await loopPromise;
  }
}
