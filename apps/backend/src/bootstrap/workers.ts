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

        if (typeof reconciliation.startReconciliationConsumer === 'function') {
          await Promise.resolve(reconciliation.startReconciliationConsumer());

          console.log('[bootstrap/workers] Reconciliation consumer started');
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
          const execution = await import('../workers/execution.worker.js');

          if (typeof execution.startExecutionWorker === 'function') {
            execution.startExecutionWorker();

            console.log('[bootstrap/workers] Execution worker started');
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
}

export async function stopWorkers(): Promise<void> {
  // run stop functions in sequence, ignore individual errors
  for (const fn of workerStopFns) {
    try { await fn(); } catch (e) { /* ignore per-worker errors */ }
  }
  workerStopFns = [];
  started = false;
  console.log('[bootstrap/workers] Workers stopped');
}
