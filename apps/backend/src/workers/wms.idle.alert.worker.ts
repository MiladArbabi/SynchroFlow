// apps/backend/src/workers/wms.idle.alert.worker.ts

/**
 * WMS IDLE ALERT WORKER (WM-17)
 * ------------------------------
 * Polls active pick/pack sessions and fires alerts
 * when operators exceed the idle threshold.
 *
 * Poll interval: 60s — granular enough for SMB warehouse ops.
 * Idle threshold: per-shop from shop_wms_settings.
 *
 * Failure isolation:
 * - Per-shop failures never crash the cycle.
 * - Worker continues on next interval regardless.
 */

import { runIdleAlertCycle } from '../services/wms/idleAlert.service.js';

const POLL_INTERVAL_MS = 60_000;
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startWmsIdleAlertWorker(): Promise<void> {
  if (running) return;
  running = true;

  console.info('[wms-idle-alert-worker] started');

  while (running) {
    try {
      await runIdleAlertCycle();
    } catch (error) {
      console.error('[wms-idle-alert-worker] cycle error', {
        error: error instanceof Error ? error.message : error,
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopWmsIdleAlertWorker(): void {
  running = false;
  console.info('[wms-idle-alert-worker] stopped');
}