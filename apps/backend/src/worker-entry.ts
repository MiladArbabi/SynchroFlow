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
import { startWebhookWorker } from './workers/webhook-dispatch.worker.js';
import { startReconciliationConsumer } from './workers/reconciliation/index.js';

import { startDomainEventOutboxDispatcher } from './workers/domain-event-outbox.dispatcher.js';

async function start() {

  console.log('[WORKER ENV]', {
    WORKER_RUNTIME: process.env.WORKER_RUNTIME,
    WEBHOOK_DISPATCH_MODE: process.env.WEBHOOK_DISPATCH_MODE,
  });
  
  console.log('[worker-entry] Booting worker runtime…');

  await initQueue();
  console.log('[worker-entry] Queue initialized');

  startSyncWorker();
  startEventWorker();
  startWebhookWorker();
  startReconciliationConsumer();

  /* startOutboxDispatcher(); */
  startDomainEventOutboxDispatcher();
 
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