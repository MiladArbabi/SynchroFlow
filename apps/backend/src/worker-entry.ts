// apps/backend/src/worker-entry.ts

import 'dotenv/config';
import './bootstrap/tsconfig-paths-register';

import { initQueue } from './queue';
import { startSyncWorker } from './sync.worker';
import { startWorker as startEventWorker } from './worker';
import { startProductIngestionWorker } from './workers/product-ingestion.worker';
import { startWebhookWorker } from './workers/webhook-dispatch.worker';
import { startReconciliationConsumer } from './workers/reconciliation';
import { debugBlockedRevenue } from './services/order-execution-intelligence/__debug.blockers';
/**
 * Obligation flag worker
 * ---------------------
 * Imported intentionally but NOT executed.
 *
 * Reason:
 * - Obligation semantics are not yet defined
 * - Execution must be explicit and scheduled
 * - Prevents accidental background writes
 */
import { computeObligationFlags } from './services/order-execution-intelligence/obligationFlags.worker';

async function start() {
  console.log('[worker-entry] Booting worker runtime…');

  await initQueue();
  console.log('[worker-entry] Queue initialized');

  // Obligation flags are computed by a future scheduled worker.
  // DO NOT call computeObligationFlags() here.
  startSyncWorker();
  startEventWorker();
  startProductIngestionWorker();
  startWebhookWorker();
  console.log('[worker-entry] Starting reconciliation consumer...');
  startReconciliationConsumer();
  (async () => {
    /**
     * Obligation flag computation
     * ---------------------------
     * Runs after reconciliation has started.
     * Safe to re-run. Writes derived execution metadata only.
     *
     * TEMP (v1):
     * - Hardcoded shopId for dev verification
     * - Will be replaced with shop iterator / cron
     */
    const shopId = 2;

    await computeObligationFlags(shopId);
    await debugBlockedRevenue(shopId);
  })();

  console.log('[worker-entry] All workers started');
}

start().catch(err => {
  console.error('[worker-entry] Fatal startup error:', err);
  process.exit(1);
});
