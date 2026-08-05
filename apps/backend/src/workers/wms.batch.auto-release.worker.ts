// apps/backend/src/workers/wms.batch.auto-release.worker.ts
import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import { releaseBatch } from '../services/wms/pickBatch.service.js';

/**
 * WMS BATCH AUTO-RELEASE WORKER
 * ------------------------------
 * Polls all shops with WMS auto-release enabled and releases
 * pick batches when eligible orders exist in the order pool.
 *
 * Per-shop configuration from shop_wms_settings:
 * - auto_release_enabled — skip shop if false
 * - auto_release_interval_minutes — minimum time between releases per shop
 *
 * Invariants:
 * - Full orders only — enforced by pickBatch.service.ts
 * - One batch released per shop per poll cycle
 * - Tenant isolation enforced via SET LOCAL per shop transaction
 * - Worker failure on one shop must not affect other shops
 */

const POLL_INTERVAL_MS = 60_000; // check every 60 seconds
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startWmsBatchAutoReleaseWorker() {
  if (running) return;
  running = true;

  console.info('[wms-auto-release-worker] started');

  // Wait one full interval before first cycle — prevents immediate
  // release on server boot. Operators should trigger manually first.
  await sleep(POLL_INTERVAL_MS);

  while (running) {
    try {
      await runAutoReleaseCycle();
    } catch (error) {
      console.error('[wms-auto-release-worker] cycle error', {
        error: error instanceof Error ? error.message : error,
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopWmsBatchAutoReleaseWorker() {
  running = false;
  console.info('[wms-auto-release-worker] stopped');
}

async function runAutoReleaseCycle(): Promise<void> {
  // 1. Load all shops with auto-release enabled
  const result = await systemQuery(
    db.raw('SELECT * FROM public.list_wms_auto_release_tenants()')
  );
  const shops: Array<{
    shop_id: number;
    auto_release_interval_minutes: number;
  }> = result.rows;

  if (shops.length === 0) return;

  for (const shop of shops) {
    try {
      await processShop(shop.shop_id, shop.auto_release_interval_minutes);
    } catch (error) {
      // Isolate per-shop failures — never crash the cycle
      console.error('[wms-auto-release-worker] shop cycle failed', {
        shopId: shop.shop_id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}

async function processShop(
  shopId: number,
  intervalMinutes: number
): Promise<void> {
  // 2. Check last released batch for this shop — enforce interval
  const lastBatch = await withTenant(shopId, (trx) =>
    trx('pick_batches')
      .where({ shop_id: shopId, release_trigger: 'auto' })
      .orderBy('released_at', 'desc')
      .select('released_at')
      .first()
  );

  if (lastBatch) {
    const minutesSinceLastRelease =
      (Date.now() - new Date(lastBatch.released_at).getTime()) / 60_000;

    if (minutesSinceLastRelease < intervalMinutes) {
      return; // too soon — skip this shop
    }
  }

  // 3. Release batch within tenant-scoped transaction
  const result = await withTenant(shopId, (trx) =>
    releaseBatch(trx, shopId, 'auto', null)
  );

  if (result) {
    console.info('[WMS_AUTO_RELEASE_BATCH_RELEASED]', {
      shopId,
      pick_batch_id: result.pick_batch_id,
      order_count: result.order_count,
      total_line_items: result.total_line_items,
    });
  }
}
