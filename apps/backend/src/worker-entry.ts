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
import { startWorkers } from './bootstrap/workers.js';
import './bootstrap/workers.js';

import { startDomainEventOutboxDispatcher } from './workers/domain-event-outbox.dispatcher.js';
import { startShopSnapshotJobDispatcher } from './workers/projections/shopSnapshotJob.dispatcher.js';

async function start() {

  console.log('[WORKER ENV]', {
    WORKER_RUNTIME: process.env.WORKER_RUNTIME,
    WEBHOOK_DISPATCH_MODE: process.env.WEBHOOK_DISPATCH_MODE,
  });
  
  console.log('[worker-entry] Booting worker runtime…');

  await initQueue();
  console.log('[worker-entry] Queue initialized');

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
   * - specter ingestion worker
   *
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

  startShopSnapshotJobDispatcher();

 console.log('[worker-entry] All workers started');

 return;
}

start().catch(err => {
  console.error('[worker-entry] Fatal startup error:', err);
  process.exit(1);
});