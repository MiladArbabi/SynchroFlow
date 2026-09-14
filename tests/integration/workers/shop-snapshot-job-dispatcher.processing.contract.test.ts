// tests/integration/workers/shop-snapshot-job-dispatcher.processing.contract.test.ts
//
// STOCK-PROTECT-03 Slice 4 — shopSnapshotJob dispatcher QUEUE-LIFECYCLE
// contract (failed-shop isolation, delete-only-on-full-success).
// PERMANENT regression contract.
// ===========================================================================
// BASELINE-GREEN GUARD, not required-RED: reading the dispatcher's current
// source (shopSnapshotJob.dispatcher.ts) shows a per-shop `try { ...; await
// trx('shop_snapshot_jobs')...delete() } catch { log only }` structure
// inside a `for` loop — this ALREADY guarantees (a) one shop's throw cannot
// prevent a sibling's iteration, and (b) the delete only runs after the full
// try-block (compute -> aggregate -> daily brief) succeeds. These tests are
// authored to lock that existing correct behavior as a permanent contract,
// not to drive new implementation — they are expected to PASS today.
//
// Uses REAL disposable Postgres for shop_snapshot_jobs row lifecycle (the
// actual thing being proven) and MOCKS the three downstream processors
// (computeShopOperationalSnapshot, aggregateAlertsForShop,
// projectDailyOperationalBrief) — the real snapshot/alerts/brief stack is
// never exercised, per the ratified test-economy correction.
//
// Starts the real dispatcher exactly ONCE for the whole file (no stop
// function exists yet — that is Slice 4's own job to add) and combines every
// assertion into that single tick to avoid stacking multiple intervals.
// Relies on --forceExit (already standard for this project's integration
// runs) rather than an explicit stop.

import crypto from 'crypto';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import * as shopOperationalSnapshotWorker from 'api-src/workers/projections/shopOperationalSnapshot.worker';
import * as alertsAggregator from 'api-src/services/alerts/alerts.aggregator';
import * as dailyOperationalBriefProjection from 'api-src/projections/dailyOperationalBriefProjection';
import {
  startShopSnapshotJobDispatcher,
  stopShopSnapshotJobDispatcher,
} from 'api-src/workers/projections/shopSnapshotJob.dispatcher';

async function createFixtureShop(unique: string): Promise<number> {
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sp-dispatch-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedDueJob(shopId: number) {
  await withTenant(shopId, (trx) =>
    trx('shop_snapshot_jobs').insert({
      shop_id: shopId,
      scheduled_at: new Date(Date.now() - 10_000), // well past the dispatcher's catchup gate
    }),
  );
}

async function jobExists(shopId: number): Promise<boolean> {
  const row = await withTenant(shopId, (trx) =>
    trx('shop_snapshot_jobs').where({ shop_id: shopId }).first('shop_id'),
  );
  return row != null;
}

describe('shopSnapshotJob dispatcher — queue lifecycle contract (baseline-green)', () => {
  jest.setTimeout(20_000);

  it('failed shop does not block sibling processing; job deleted only after the full chain succeeds; a late-stage failure retains the job', async () => {
    const shopFail = await createFixtureShop(`fail-${crypto.randomUUID().slice(0, 8)}`);
    const shopSucceed = await createFixtureShop(`succeed-${crypto.randomUUID().slice(0, 8)}`);
    const shopLateFail = await createFixtureShop(`latefail-${crypto.randomUUID().slice(0, 8)}`);

    await seedDueJob(shopFail);
    await seedDueJob(shopSucceed);
    await seedDueJob(shopLateFail);

    const computeSpy = jest
      .spyOn(shopOperationalSnapshotWorker, 'computeShopOperationalSnapshot')
      .mockImplementation(async (shopIdStr: string) => {
        if (Number(shopIdStr) === shopFail) {
          throw new Error('[TEST] computeShopOperationalSnapshot deliberately failing');
        }
        return undefined as any;
      });

    const aggregateSpy = jest
      .spyOn(alertsAggregator, 'aggregateAlertsForShop')
      .mockResolvedValue(undefined as any);

    const briefSpy = jest
      .spyOn(dailyOperationalBriefProjection, 'projectDailyOperationalBrief')
      .mockImplementation(async (_trx: any, shopIdStr: string) => {
        if (Number(shopIdStr) === shopLateFail) {
          throw new Error('[TEST] projectDailyOperationalBrief deliberately failing');
        }
        return undefined as any;
      });

    try {
      await startShopSnapshotJobDispatcher();

      // Wait past the SQL function's 2s catchup gate AND the dispatcher's
      // own 2s poll interval, so one real tick fires and processes all three.
      await new Promise((resolve) => setTimeout(resolve, 4500));

      // Sibling isolation: all three shops must have been ATTEMPTED —
      // shopFail's throw must not have skipped its siblings.
      expect(computeSpy).toHaveBeenCalledWith(String(shopFail));
      expect(computeSpy).toHaveBeenCalledWith(String(shopSucceed));
      expect(computeSpy).toHaveBeenCalledWith(String(shopLateFail));

      // Full-success shop: job deleted.
      expect(await jobExists(shopSucceed)).toBe(false);

      // Early-failure shop: job retained (never reached delete).
      expect(await jobExists(shopFail)).toBe(true);

      // Late-failure shop: first two steps succeeded, but the job is still
      // retained — deletion is gated on the WHOLE chain, not partial progress.
      expect(await jobExists(shopLateFail)).toBe(true);
      expect(aggregateSpy).toHaveBeenCalledWith(shopLateFail);
    } finally {
      await stopShopSnapshotJobDispatcher();
      computeSpy.mockRestore();
      aggregateSpy.mockRestore();
      briefSpy.mockRestore();
    }
  });
});
