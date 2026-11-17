// apps/backend/src/workers/wms.pick-recovery.worker.ts

/**
 * WMS PICK RECOVERY WORKER (SF-PICK-ASSIGN-01)
 * --------------------------------------------
 * Returns expired, unclaimed Pick assignments to first-to-claim on a 60s
 * cadence (same as the idle-alert worker). Thresholds are per warehouse.
 * Per-shop failures never crash the cycle.
 */

import { runPickRecoveryCycle } from '../services/wms/pickRecovery.service.js';

const POLL_INTERVAL_MS = 60_000;
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startWmsPickRecoveryWorker(): Promise<void> {
  if (running) return;
  running = true;
  console.info('[wms-pick-recovery-worker] started');

  while (running) {
    try {
      await runPickRecoveryCycle();
    } catch (error) {
      console.error('[wms-pick-recovery-worker] cycle error', {
        error: error instanceof Error ? error.message : error,
      });
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopWmsPickRecoveryWorker(): void {
  running = false;
  console.info('[wms-pick-recovery-worker] stopped');
}
