// apps/backend/src/workers/carrier-stall-detection.worker.ts
import { runCarrierStallDetectionCycle } from '../services/wms/carrierStallDetection.service.js';

const POLL_INTERVAL_MS = 900_000; // 15 minutes — stall threshold is 72h, no need to poll tighter

let intervalHandle: NodeJS.Timeout | null = null;

export async function startCarrierStallDetectionWorker(): Promise<void> {
  console.info('[CARRIER_STALL_DETECTION_WORKER_STARTED]', { poll_interval_ms: POLL_INTERVAL_MS });
  await runCarrierStallDetectionCycle();
  intervalHandle = setInterval(async () => {
    try {
      await runCarrierStallDetectionCycle();
    } catch (err) {
      console.error('[CARRIER_STALL_DETECTION_WORKER_ERROR]', { error: (err as Error).message });
    }
  }, POLL_INTERVAL_MS);
}

export async function stopCarrierStallDetectionWorker(): Promise<void> {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}