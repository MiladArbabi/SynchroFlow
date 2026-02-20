// apps/backend/src/worker-entry.ts
import './bootstrap/env.js';

// 🔒 HARD GUARANTEE: Worker runtime flag
// --------------------------------------
// Worker must always execute webhooks synchronously.
// This flag is authoritative and must not depend on shell env.
process.env.WORKER_RUNTIME = 'true';

import './bootstrap/tsconfig-paths-register.js';
import './api/shopify/shopify.webhook.js';

import { initQueue } from './queue.js';
import { startSyncWorker } from './sync.worker.js';
import { startWorker as startEventWorker } from './worker.js';
import { startProductIngestionWorker } from './workers/product-ingestion.worker.js';
import { startWebhookWorker } from './workers/webhook-dispatch.worker.js';
/* import { startWorker as startReturnsIngestionWorker } from './workers/returnsIngestion.worker.js';*/
import { reconcileOrderFulfillment, startReconciliationConsumer } from './workers/reconciliation/index.js';

async function start() {

  console.log('[WORKER ENV]', {
    WORKER_RUNTIME: process.env.WORKER_RUNTIME,
    WEBHOOK_DISPATCH_MODE: process.env.WEBHOOK_DISPATCH_MODE,
  });
  
  console.log('[worker-entry] Booting worker runtime…');

  await initQueue();
  console.log('[worker-entry] Queue initialized');

  startSyncWorker();
/*   startEventWorker();
 */  startProductIngestionWorker();
  startWebhookWorker();
/*   startReturnsIngestionWorker();
 */  /* console.log('[worker-entry] Starting reconciliation consumer...'); */
  startReconciliationConsumer();
  // startRefundsIngestionWorker(); // DEPRECATED — intentionally disabled
 
  /**
  * DEV-ONLY: Obligation evaluation hook
  * ----------------------------------
  * Purpose:
  * - Manual verification during schema bring-up
  * - MUST be removed once scheduled workers exist
  *
  * Rules:
  * - Hardcoded shopId is allowed ONLY here
  * - Never runs implicitly
  */

 console.log('[worker-entry] All workers started');

 return;
}

start().catch(err => {
  console.error('[worker-entry] Fatal startup error:', err);
  process.exit(1);
});