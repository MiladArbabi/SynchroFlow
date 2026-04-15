// apps/backend/src/workers/morning-brief.worker.ts
//
// Morning Brief Worker (OVR-02)
// ------------------------------
// Runs once per day at 5am UTC.
// Pre-computes morning brief for all active shops.
//
// Per-shop failures are isolated — cycle always continues.
// Shops with no open subscription row are skipped silently.
//
// CHANGE POLICY:
//   Brief computation lives in overviewMorningBrief.resolver.ts.
//   Schedule is hardcoded to 5am UTC — adjust if timezone-aware
//   delivery is required in future (OVR-04).

import db from '@lasyncro/backend-core/db.js';
import {
  computeMorningBrief,
  persistMorningBrief,
} from '../services/overview-ft2/overviewMorningBrief.resolver.js';

const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TARGET_HOUR_UTC = 5; // 5am UTC

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(TARGET_HOUR_UTC, 0, 0, 0);
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runMorningBriefCycle(): Promise<void> {
  // Fetch all active shops with a subscription row
  const shops = await db('shop_subscriptions')
    .whereIn('status', ['active', 'trialing'])
    .select('shop_id');

  console.info('[morning-brief-worker] cycle started', { shopCount: shops.length });

  let succeeded = 0;
  let failed = 0;

  for (const { shop_id } of shops) {
    try {
      await db.raw(`SET LOCAL "app.current_tenant" = '${shop_id}'`);

      const brief = await computeMorningBrief({ shopId: shop_id });

      await db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shop_id}'`);
        await persistMorningBrief(shop_id, brief, trx);
      });

      succeeded++;
    } catch (err) {
      // Isolated per shop — never block the cycle
      failed++;
      console.error('[morning-brief-worker] shop failed', {
        shopId: shop_id,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  console.info('[morning-brief-worker] cycle complete', { succeeded, failed });
}

export async function startMorningBriefWorker(): Promise<void> {
  if (running) return;
  running = true;

  // Wait until 5am UTC before first run
  const initialDelay = msUntilNextRun();
  console.info('[morning-brief-worker] started — first run in', {
    minutes: Math.round(initialDelay / 60000),
  });

  await sleep(initialDelay);

  while (running) {
    try {
      await runMorningBriefCycle();
    } catch (err) {
      console.error('[morning-brief-worker] cycle error', {
        error: err instanceof Error ? err.message : err,
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopMorningBriefWorker(): void {
  running = false;
  console.info('[morning-brief-worker] stopped');
}