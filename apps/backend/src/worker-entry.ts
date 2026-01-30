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

async function start() {
  console.log('[worker-entry] Booting worker runtime…');

  await initQueue();
  console.log('[worker-entry] Queue initialized');

  startSyncWorker();
  startEventWorker();
  startProductIngestionWorker();
  startWebhookWorker();
  console.log('[worker-entry] Starting reconciliation consumer...');
  startReconciliationConsumer();
  (async () => {
    await debugBlockedRevenue(2);
  })();

  console.log('[worker-entry] All workers started');
}

start().catch(err => {
  console.error('[worker-entry] Fatal startup error:', err);
  process.exit(1);
});
