// apps/backend/src/worker-entry.ts
import './bootstrap/env.js';

// 🔒 HARD GUARANTEE: Worker runtime flag
// --------------------------------------
// Worker must always execute webhooks synchronously.
// This flag is authoritative and must not depend on shell env.
process.env.WORKER_RUNTIME = 'true';

import './bootstrap/tsconfig-paths-register.js';
import './api/shopify/shopify.webhook.js';

import { initQueue, closeQueue } from './queue.js';
import { startWorkers, stopWorkers } from './bootstrap/workers.js';
import { createProcessShutdown } from './bootstrap/processShutdown.js';

import { startDomainEventOutboxDispatcher } from './workers/domain-event-outbox.dispatcher.js';
import { startProjectionHealthWorker } from './workers/projection.health.worker.js';
import { assertRuntimeDatabaseIdentity } from '@lasyncro/backend-core/db.js';

const shutdown = createProcessShutdown({
  processName: 'worker-entry',
  startDrain: () => [
    stopWorkers(),
  ],
  cleanup: [
    {
      name: 'queue',
      run: () => closeQueue(),
    },
  ],
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function start() {
  // WORKER-CRASH-01: server.ts:47 contains unowned rejections for the HTTP
  // runtime (RUNTIME-BOOT-02, v270). The worker runs the SAME startWorkers()
  // fleet and had no such handler, so one fault killed every worker in the
  // process. superviseWorker cannot cover this class: TENANT_CONTEXT_MISSING
  // throws from the patched queryBuilder.then (db.ts, RUNTIME-BOOT-05), which
  // rejects off-chain and reaches no caller's catch.
  // Registered before any await — infrastructure boot can reject too.
  process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED_REJECTION] contained, worker kept alive:', reason);
  });

  // SEC-RLS-P0: the standalone worker must enforce the same restricted
  // database identity as the HTTP runtime.
  await assertRuntimeDatabaseIdentity();

  console.log('[WORKER ENV]', {
    WORKER_RUNTIME: process.env.WORKER_RUNTIME,
    WEBHOOK_DISPATCH_MODE: process.env.WEBHOOK_DISPATCH_MODE,
  });
  
  console.log('[worker-entry] Booting worker runtime…');

  await initQueue();
  console.log('[worker-entry] Queue initialized');

  // Declare all queues and exchanges before any worker attaches
  const { declareTopology } = await import('./queue.topology.js');
  await declareTopology();
  console.log('[worker-entry] Queue topology declared');

  /**
   * DEV SAFETY: PURGE STALE EVENT TRIGGERS
   * --------------------------------------
   * Projection engine enforces strict monotonic ordering.
   *
   * When the worker restarts during development,
   * RabbitMQ may still contain older domain_event_id triggers.
   *
   * These stale triggers will violate the projection cursor
   * and crash the worker.
   *
   * Therefore we purge the events queue in development mode.
   */

  if (process.env.NODE_ENV === 'development') {
    const { execSync } = await import('node:child_process');

    try {
      execSync(
        'docker exec synchroflow_mq rabbitmqctl purge_queue events',
        { stdio: 'inherit' }
      );

      console.log('[worker-entry] events queue purged (dev safety)');
    } catch (err) {
      console.warn('[worker-entry] events purge skipped');
    }
  }

  /**
   * BOOTSTRAP WORKERS
   * -----------------
   * Starts auxiliary workers registered in bootstrap/workers.ts.
   *
   * Required for:
   * - product_ingestion worker
   * Without this call queues may accumulate messages silently.
   */

  await startWorkers();

  startDomainEventOutboxDispatcher();

  /**
   * DISABLED — RECONCILIATION EXECUTION (CRITICAL FIX)
   * --------------------------------------------------
   * Reconciliation MUST run strictly AFTER projection completes
   * inside the canonical event processing pipeline.
   *
   * Async dispatcher causes:
   * - race condition with projection
   * - AGE_PROJECTION_NOT_MATERIALIZED failures
   * - non-deterministic rebuilds
   *
   * Source of truth:
   * processDomainEvent → projection → reconciliation
   */
  console.warn('[RECONCILIATION_DISPATCHER_DISABLED]');
 // NOTE: startShopSnapshotJobDispatcher is started via startWorkers() → bootstrap/workers.ts
 // Do NOT call it here — doing so creates a duplicate setInterval poll loop on shop_snapshot_jobs,
 // causing every snapshot job to execute twice.

  /**
   * PROJECTION HEALTH WORKER
   * --------------------------------
   * Monitors cursor lag and emits structured health signals.
   * Detects stalled projections before operators notice stale UI.
   */
  await startProjectionHealthWorker();

  console.log('[worker-entry] All workers started');

 return;
}

start().catch(err => {
  console.error('[worker-entry] Fatal startup error:', err);
  process.exit(1);
});
