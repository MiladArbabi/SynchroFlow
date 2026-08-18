import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

/**
 * MORNING BRIEF CYCLE VERIFICATION
 * --------------------------------
 * SRC-05b.
 *
 * The brief worker fires once an hour and briefs only the shops whose OWN
 * local hour has just turned 5. That selection is unobservable in normal
 * operation — the loop runs on a schedule with no invocation path, so a
 * wiring bug in it can only be reviewed, never exercised.
 *
 * This runner reports, per shop, what the cycle WOULD do and why: local clock,
 * whether the hour matches, when the shop was last briefed, and whether that
 * predates its current local day. With --apply it then runs the real cycle.
 *
 * READ ONLY. Invoking the cycle lives in scripts/run-morning-brief-cycle.mjs,
 * which runs under plain node against dist/ — the same execution model as
 * production. Keeping them separate avoids a script whose report is built from
 * source while its action runs compiled output: with a stale dist those two
 * halves can disagree silently.
 *
 * Usage:
 *   npm run verify:morning-brief -w apps/backend
 */

const TARGET_LOCAL_HOUR = 5;

// Dynamic — db.ts reads process.env at module load, so it must not be hoisted
// above dotenv.config() above. Same pattern as reevaluate-order-constraints.ts.
const { systemQuery, withTenant } = await import('@lasyncro/backend-core/db.js');
const db = (await import('@lasyncro/backend-core/db.js')).default;
const { getShopClock, startOfShopDay } = await import('../services/shop/shopClock.service.js');

const tenantLookup = await systemQuery(
  db.raw('SELECT shop_id FROM public.list_morning_brief_tenants()')
);
const shops: Array<{ shop_id: number }> = tenantLookup.rows;

console.info(`[verify] ${shops.length} eligible shop(s); now ${new Date().toISOString()}`);

let dueCount = 0;

for (const { shop_id } of shops) {
  const row = await withTenant(shop_id, async (trx: any) => {
    const shopRow = await trx('shops').where('id', shop_id).first('timezone');
    const last = await trx('morning_brief_snapshots')
      .where('shop_id', shop_id)
      .first('generated_at');
    return { timezone: shopRow?.timezone ?? null, generatedAt: last?.generated_at ?? null };
  });

  const clock = getShopClock(row.timezone);
  const hourMatches = clock.hour === TARGET_LOCAL_HOUR;
  const dayStart = startOfShopDay(row.timezone);
  const staleEnough = row.generatedAt
    ? new Date(row.generatedAt).getTime() < dayStart.getTime()
    : true;
  const due = hourMatches && staleEnough;

  if (due) dueCount++;

  console.info(`[verify] shop ${shop_id}`, {
    timezone: row.timezone,
    localTime: `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`,
    hourMatches,
    lastBrief: row.generatedAt ? new Date(row.generatedAt).toISOString() : null,
    localDayStart: dayStart.toISOString(),
    staleEnough,
    due,
  });
}

console.info(`[verify] ${dueCount} shop(s) due this cycle`);

console.info('[verify] report only — run the cycle with:');
console.info('[verify]   npm run run:morning-brief -w apps/backend -- --confirm=SRC-05B');

await db.destroy();
process.exit(0);
