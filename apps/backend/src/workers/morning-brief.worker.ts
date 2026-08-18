// apps/backend/src/workers/morning-brief.worker.ts
//
// Morning Brief Worker (OVR-02)
// ------------------------------
// Polls hourly; briefs each shop at 5am in ITS OWN timezone (SRC-05b).
//
// It previously ran once at 05:00 UTC and briefed everyone in that pass, which
// meant 07:00 in Stockholm and 22:00 the previous evening in Los Angeles — a
// "morning" brief describing a day that had already ended. shops.timezone
// carries a real IANA zone since SRC-05a, so selection is now per shop.
//
// Because the 24h sleep no longer guarantees one run per shop per day, the
// idempotency guard moved into the loop: skip if the shop's last brief was
// generated after its own local day began. This also covers DST fall-back,
// where 05:00 local occurs twice.
//
// Zones offset by 30 or 45 minutes are briefed at :30 or :45 past 5 rather
// than on the hour — a deliberate trade against quadrupling the cycle count.
//
// Per-shop failures are isolated — cycle always continues.
// Shops with no open subscription row are skipped silently.
//
// SRC-07 (fixed): computeMorningBrief is called here without ambient tenant
//   context, because superviseWorker starts this worker outside any request.
//   The resolver used to read the global db unscoped, so the guard threw for
//   every shop. The per-shop catch below did its job and counted them into
//   failed++, which is exactly why this went unnoticed: the cycle completed
//   'successfully' with zero briefs generated, every day, logged only as a
//   number nobody was watching.
//   The resolver now scopes its own reads, so it is safe for any caller. Do
//   not reintroduce bare db reads there.
//
// CHANGE POLICY:
//   Brief computation lives in overviewMorningBrief.resolver.ts.
//   Selection is verifiable: `npm run verify:morning-brief -w apps/backend`
//   reports what the cycle would do without writing. Invoking it for real is
//   `npm run run:morning-brief -w apps/backend -- --confirm=SRC-05B`, which
//   runs against dist/ under plain node.

import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';
import {
  computeMorningBrief,
  persistMorningBrief,
} from '../services/overview-ft2/overviewMorningBrief.resolver.js';
import { getShopClock, startOfShopDay } from '../services/shop/shopClock.service.js';

// SRC-05b: the cycle polls hourly and briefs only the shops whose OWN local
// hour has just turned 5. It used to run once at 05:00 UTC and brief everyone,
// which meant 07:00 in Stockholm and 22:00 the previous evening in Los
// Angeles — a "morning" brief describing a day that had already ended.
//
// Zones offset by 30 or 45 minutes (India, Nepal, parts of Australia) are
// briefed at :30 or :45 past 5 rather than on the hour. That is a deliberate
// trade: a brief 45 minutes late is not the failure being fixed here, and a
// 15-minute poll would quadruple the cycle count for that alone.
const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const TARGET_LOCAL_HOUR = 5; // 5am in the shop's own timezone

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SRC-05b: delay to the top of the next hour, so the cycle lands close to :00
 * in every zone rather than drifting by however long after boot the worker
 * started. Replaces msUntilNextRun(), which anchored the whole schedule to
 * 05:00 UTC.
 */
function msUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Exported for verification. A scheduled job with no invocation path can only
 * be reviewed, never exercised — which is how a wiring bug survives review.
 * Nothing outside this module calls it in normal operation; the worker loop
 * below is its only production caller.
 */
export async function runMorningBriefCycle(): Promise<void> {
  // Fetch all active shops with a subscription row
  const tenantLookup = await systemQuery(
    db.raw('SELECT shop_id FROM public.list_morning_brief_tenants()')
  );
  const shops: Array<{ shop_id: number }> = tenantLookup.rows;

  console.info('[morning-brief-worker] cycle started', { shopCount: shops.length });

  let succeeded = 0;
  let failed = 0;

  let skipped = 0;

  for (const { shop_id } of shops) {
    try {
      // SRC-05b: is it 5am at THIS shop? Read inside withTenant because the
      // tenant context is already the RLS boundary these tables sit behind —
      // widening list_morning_brief_tenants() to carry the timezone would mean
      // altering a SECURITY DEFINER object for a per-shop lookup.
      const due = await withTenant(shop_id, async (trx) => {
        const shopRow = await trx('shops').where('id', shop_id).first('timezone');
        const clock = getShopClock(shopRow?.timezone ?? null);
        if (clock.hour !== TARGET_LOCAL_HOUR) return false;

        // The 24h sleep used to guarantee one brief per shop per day. With an
        // hourly poll that guarantee is gone, so it moves here: skip if this
        // shop has already been briefed during its current local day. Also
        // covers DST fall-back, where 05:00 local occurs twice.
        const last = await trx('morning_brief_snapshots')
          .where('shop_id', shop_id)
          .first('generated_at');

        if (!last?.generated_at) return true;

        // "Was the last brief generated after this shop's day began?" stated
        // directly, rather than inferred from a weekday match plus a 24h
        // window — two conditions approximating one fact.
        const dayStart = startOfShopDay(shopRow?.timezone ?? null);
        return new Date(last.generated_at).getTime() < dayStart.getTime();
      });

      if (!due) {
        skipped++;
        continue;
      }

      const brief = await computeMorningBrief({ shopId: shop_id });

      await withTenant(shop_id, async (trx) => {
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

  console.info('[morning-brief-worker] cycle complete', { succeeded, failed, skipped });
}

export async function startMorningBriefWorker(): Promise<void> {
  if (running) return;
  running = true;

  // SRC-05b: align to the top of the hour, then poll hourly. No shop is
  // briefed until its own local 5am, so the first cycle is usually a no-op.
  const initialDelay = msUntilNextHour();

  // DEBUG only — fires on every restart, intentionally silent in production.
  console.debug('[morning-brief-worker] started — first cycle in', {
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
