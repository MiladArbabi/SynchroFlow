// apps/backend/src/workers/carrier-tracking-reconciliation.worker.ts
//
// #1114 STEP 8C — carrier tracking reconciliation worker.
//
// Thin polling wrapper around the existing reconciliation service. Every
// actual reconciliation behavior (selector discovery, tenant re-fetch,
// credential resolution, provider routing, shared ingestion, alerts, Return
// Jobs, per-row failure handling) belongs to
// carrierTrackingReconciliation.service.ts and is never duplicated here —
// this file owns ONLY interval scheduling, the in-flight overlap guard, and
// cycle-level failure containment.
//
// Fires an immediate first cycle on start (webhooks remain primary; this is
// the fallback/self-healing path, so it should not wait 30 minutes to begin
// repairing missed webhooks), then polls every 30 minutes. A slow cycle
// cannot overlap with itself — an interval tick that fires while the
// previous cycle is still in flight is skipped, not queued, matching the
// existing shopSnapshotJob.dispatcher precedent.

import { runCarrierTrackingReconciliationCycle } from '../services/wms/carrierTrackingReconciliation.service.js';

const POLL_INTERVAL_MS = 1_800_000; // 30 minutes

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let cycleInFlight: Promise<void> | null = null;

/**
 * Starts one reconciliation cycle unless one is already in flight. Never
 * rethrows a cycle-level failure — it is contained and logged so a single
 * bad cycle can never kill the poller or produce an unhandled rejection.
 * No in-cycle retry: the next scheduled tick is the retry.
 */
async function runGuardedCycle(): Promise<void> {
  if (cycleInFlight) {
    console.warn('[CARRIER_RECONCILIATION_CYCLE_SKIPPED_OVERLAP]');
    return;
  }

  const cyclePromise = (async () => {
    try {
      await runCarrierTrackingReconciliationCycle();
    } catch (err) {
      console.error('[CARRIER_RECONCILIATION_WORKER_CYCLE_FAILED]', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  cycleInFlight = cyclePromise;
  try {
    await cyclePromise;
  } finally {
    cycleInFlight = null;
  }
}

export async function startCarrierTrackingReconciliationWorker(): Promise<void> {
  if (intervalHandle) {
    // Already started — idempotent, never a duplicate poller.
    return;
  }

  console.log('[CARRIER_RECONCILIATION_WORKER_STARTED]', { pollIntervalMs: POLL_INTERVAL_MS });

  // Register the interval BEFORE kicking off the first cycle, and do not
  // await that first cycle here — the poller's lifecycle must be
  // established promptly regardless of how long reconciliation takes.
  intervalHandle = setInterval(() => {
    void runGuardedCycle();
  }, POLL_INTERVAL_MS);

  void runGuardedCycle();
}

export async function stopCarrierTrackingReconciliationWorker(): Promise<void> {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
