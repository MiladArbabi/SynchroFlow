// apps/backend/src/workers/trial-expiry.worker.ts
//
// Trial Expiry Worker (MON-07)
// ----------------------------
// Polls every 6 hours:
//   - Downgrades expired trialing shops to Starter
//   - Sends D-3 and D-1 reminder emails
//
// Per-shop failures are isolated — cycle always continues.

import { runTrialExpiryCycle } from '../services/trial-expiry.service.js';

const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startTrialExpiryWorker(): Promise<void> {
  if (running) return;
  running = true;

  console.info('[trial-expiry-worker] started');

  while (running) {
    try {
      await runTrialExpiryCycle();
    } catch (err) {
      console.error('[trial-expiry-worker] cycle error', {
        error: err instanceof Error ? err.message : err,
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

export function stopTrialExpiryWorker(): void {
  running = false;
  console.info('[trial-expiry-worker] stopped');
}