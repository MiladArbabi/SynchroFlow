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

/**
 * ORDER RECONCILIATION DISPATCHER
 * --------------------------------
 * Consumes order_reconciliation_intents and
 * materializes analytical snapshots:
 *
 * - order_margin_snapshot
 * - order_risk_snapshot
 * - order_age_snapshot
 * - orders_operational_control_snapshot
 *
 * Without this worker the Orders UI shows zeros.
 */
import { startReconciliationIntentDispatcher } from './workers/reconciliation/reconciliation.intent.dispatcher.js';

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
  startReconciliationIntentDispatcher(); // executes reconciliation intents

 console.log('[worker-entry] All workers started');

 return;
}

start().catch(err => {
  console.error('[worker-entry] Fatal startup error:', err);
  process.exit(1);
});