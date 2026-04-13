// apps/backend/src/bootstrap/workers.ts
// Lazily start/stop background workers — keep this isolated so server boot is cleaner.
//
// Minimal, backward-compatible update: keep startWorkers/stopWorkers API but also
// attempt to start the Specter ingestion worker when available. Stop functions are
// accumulated and invoked in sequence on shutdown.

let started = false;
let workerStopFns: Array<() => Promise<void> | void> = [];

/**
 * startWorkers
 * - idempotent
 * - each worker may optionally export a stop function which we push into workerStopFns
 */
export async function startWorkers(): Promise<void> {
  if (started) return;
  started = true;

  // start api worker
  try {
    const w = await import('../worker.js');
    if (typeof w.startWorker === 'function') {
      w.startWorker();
      if ((w as any).stopWorker && typeof (w as any).stopWorker === 'function') {
        workerStopFns.push(async () => await (w as any).stopWorker());
      }
      console.log('[bootstrap/workers] API worker started');
    }
  } catch (err) {
    console.warn('[bootstrap/workers] Failed to start API worker (ignored in dev):', err && (err as Error).message ? (err as Error).message : err);
  }

  // start sync worker
  try {
    const s = await import('../sync.worker.js');
    if (typeof s.startSyncWorker === 'function') {
      s.startSyncWorker();
      if ((s as any).stopSyncWorker && typeof (s as any).stopSyncWorker === 'function') {
        workerStopFns.push(async () => await (s as any).stopSyncWorker());
      }
      console.log('[bootstrap/workers] Sync worker started');
    }
  } catch (err) {
    console.warn('[bootstrap/workers] Failed to start Sync worker (ignored in dev):', err && (err as Error).message ? (err as Error).message : err);
  }

  // start Specter ingestion worker (FT0) if present
  try {
    const specter = await import('../workers/specter-ingestion.worker.js');
    if (typeof specter.startSpecterIngestionWorker === 'function') {
      try { await Promise.resolve(specter.startSpecterIngestionWorker()); } catch (_) { /* ignore start error */ }
      if (typeof specter.stopSpecterIngestionWorker === 'function') {
        workerStopFns.push(async () => await specter.stopSpecterIngestionWorker());
      }
      console.log('[bootstrap/workers] Specter ingestion worker started');
    }
  } catch (err) {
    // Not fatal — specter worker may not exist in tests/dev
    console.warn('[bootstrap/workers] Specter ingestion worker not available (skipping):', err && (err as Error).message ? (err as Error).message : err);
  }

  // start Product ingestion worker (FT0)
  try {
    const product = await import('../workers/product-ingestion.worker.js');
    if (typeof product.startProductIngestionWorker === 'function') {
      await Promise.resolve(product.startProductIngestionWorker());
      if (typeof product.stopProductIngestionWorker === 'function') {
        workerStopFns.push(async () => await product.stopProductIngestionWorker());
      }
      console.log('[bootstrap/workers] Product ingestion worker started');

      /**
       * RECONCILIATION CONSUMER
       * -----------------------
       * Consumes fulfillment.reconciliation queue and executes
       * analytical snapshot materialization.
       *
       * Without this worker:
       * - reconciliation queue accumulates
       * - snapshot tables remain empty
       * - Orders UI shows zeros.
       */
      try {
        const reconciliation = await import('../workers/reconciliation/reconciliation.consumer.js');

        /**
         * DISABLED — RECONCILIATION CONSUMER (CRITICAL)
         * ---------------------------------------------
         * Reconciliation MUST execute synchronously inside:
         * processDomainEvent → projection → reconciliation
         *
         * Async consumer causes:
         * - race with projection
         * - AGE_PROJECTION_NOT_MATERIALIZED
         * - non-deterministic rebuilds
         *
         * This is permanently disabled.
         */
        if (typeof reconciliation.startReconciliationConsumer === 'function') {
          console.warn('[RECONCILIATION_CONSUMER_DISABLED]');
          // DO NOT START
        }

        /**
         * EXECUTION WORKER
         * ----------------
         * Consumes execution.jobs.v1 queue and executes decisions.
         *
         * Guarantees:
         * - decision → action pipeline
         * - lifecycle tracking
         * - durable execution via queue
         *
         * Without this worker:
         * - execution queue accumulates
         * - decisions remain unexecuted
         */
        try {
          /**
           * EXECUTION HANDLER REGISTRATION (CRITICAL)
           * -----------------------------------------
           * Must run BEFORE execution worker starts.
           *
           * Guarantees:
           * - All action_types resolve to handlers
           * - Prevents runtime execution failure
           */
          const { registerExecutionHandler, listExecutionHandlers } =
            await import('../execution/execution.registry.js');

          const {
            proceedFulfillmentHandler
          } = await import('../execution/handlers/proceed_fulfillment.handler.js');

          registerExecutionHandler('proceed_fulfillment', proceedFulfillmentHandler);

          const {
            resolveOperationalBlockHandler
          } = await import('../execution/handlers/resolve_operational_block.handler.js');

          registerExecutionHandler('resolve_operational_block', resolveOperationalBlockHandler);

          const {
            resolveInventoryBlockHandler
          } = await import('../execution/handlers/resolve_inventory_block.handler.js');

          registerExecutionHandler('resolve_inventory_block', resolveInventoryBlockHandler);

          const {
            resolveCustomerBlockHandler
          } = await import('../execution/handlers/resolve_customer_block.handler.js');

          registerExecutionHandler('resolve_customer_block', resolveCustomerBlockHandler);

          /**
           * STARTUP VISIBILITY (CRITICAL)
           */
          console.info('[EXECUTION_HANDLERS_REGISTERED]', {
            handlers: listExecutionHandlers()
          });

          /**
           * HANDLER COVERAGE VALIDATION (CRITICAL)
           * --------------------------------------
           * Ensures all emitted action_types are registered.
           *
           * Prevents:
           * - silent production failures
           * - missing handler regressions
           */
          const REQUIRED_ACTIONS = [
            'proceed_fulfillment',
            'resolve_operational_block',
            'resolve_inventory_block',
            'resolve_customer_block'
          ];

          const registered = listExecutionHandlers();

          const missing = REQUIRED_ACTIONS.filter(a => !registered.includes(a));

          if (missing.length > 0) {
            console.error('[EXECUTION_HANDLER_COVERAGE_GAP]', {
              missing,
              registered
            });

            throw new Error('[FATAL] Missing execution handlers');
          }

          const execution = await import('../workers/execution.worker.js');
          const dispatcher = await import('../workers/execution.dispatcher.worker.js');

          if (typeof execution.startExecutionWorker === 'function') {
            execution.startExecutionWorker();

            console.log('[bootstrap/workers] Execution worker started');
          }

          /**
           * EXECUTION DISPATCHER (CRITICAL BRIDGE)
           * --------------------------------------
           * Connects DB → RabbitMQ
           *
           * Must start AFTER execution worker is ready.
           */
          if (typeof dispatcher.startExecutionDispatcher === 'function') {
            dispatcher.startExecutionDispatcher();

            console.log('[bootstrap/workers] Execution dispatcher started');
          }
        } catch (err) {
          console.warn(
            '[bootstrap/workers] Execution worker not available:',
            err && (err as Error).message ? (err as Error).message : err
          );
        }

      } catch (err) {
        console.warn(
          '[bootstrap/workers] Reconciliation consumer not available:',
          err && (err as Error).message ? (err as Error).message : err
        );
      }
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Product ingestion worker not available (skipping):',
      err && (err as Error).message ? (err as Error).message : err
    );
  }

  // start WMS batch auto-release worker
  try {
    const wmsAutoRelease = await import('../workers/wms.batch.auto-release.worker.js');
    if (typeof wmsAutoRelease.startWmsBatchAutoReleaseWorker === 'function') {
      await Promise.resolve(wmsAutoRelease.startWmsBatchAutoReleaseWorker());
      if (typeof wmsAutoRelease.stopWmsBatchAutoReleaseWorker === 'function') {
        workerStopFns.push(async () => await wmsAutoRelease.stopWmsBatchAutoReleaseWorker());
      }
      console.log('[bootstrap/workers] WMS batch auto-release worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] WMS auto-release worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }

  // start WMS idle alert worker
  try {
    const wmsIdleAlert = await import('../workers/wms.idle.alert.worker.js');
    if (typeof wmsIdleAlert.startWmsIdleAlertWorker === 'function') {
      await Promise.resolve(wmsIdleAlert.startWmsIdleAlertWorker());
      if (typeof wmsIdleAlert.stopWmsIdleAlertWorker === 'function') {
        workerStopFns.push(async () => wmsIdleAlert.stopWmsIdleAlertWorker());
      }
      console.log('[bootstrap/workers] WMS idle alert worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] WMS idle alert worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }

  // start trial expiry worker (MON-07)
  try {
    const trialExpiry = await import('../workers/trial-expiry.worker.js');
    if (typeof trialExpiry.startTrialExpiryWorker === 'function') {
      await Promise.resolve(trialExpiry.startTrialExpiryWorker());
      if (typeof trialExpiry.stopTrialExpiryWorker === 'function') {
        workerStopFns.push(async () => trialExpiry.stopTrialExpiryWorker());
      }
      console.log('[bootstrap/workers] Trial expiry worker started');
    }
  } catch (err) {
    console.warn(
      '[bootstrap/workers] Trial expiry worker not available:',
      err && (err as Error).message ? (err as Error).message : err
    );
  }
}

export async function stopWorkers(): Promise<void> {
  // run stop functions in sequence, ignore individual errors
  for (const fn of workerStopFns) {
    try { await fn(); } catch (e) { /* ignore per-worker errors */ }
  }
  workerStopFns = [];
  started = false;
  console.log('[bootstrap/workers] Workers stopped');
};