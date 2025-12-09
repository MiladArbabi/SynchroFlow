// apps/backend/src/bootstrap/workers.ts
// Lazily start/stop background workers — keep this isolated so server boot is cleaner.
let started = false;
let workerStopFns: Array<() => Promise<void> | void> = [];

export async function startWorkers(): Promise<void> {
  if (started) return;
  started = true;

  // start api worker
  try {
    const w = await import('../worker');
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
    const s = await import('../sync.worker');
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
}

export async function stopWorkers(): Promise<void> {
  // run stop functions in sequence, ignore individual errors
  for (const fn of workerStopFns) {
    try { await fn(); } catch (_) { /* ignore */ }
  }
  workerStopFns = [];
  started = false;
  console.log('[bootstrap/workers] Workers stopped');
}
