import {
  claimNotificationDeliveries,
  executeClaimedNotificationDelivery,
  NOTIFICATION_DELIVERY_BATCH_SIZE,
  NOTIFICATION_DELIVERY_LEASE_SECONDS,
  NOTIFICATION_DELIVERY_POLL_INTERVAL_MS,
  type DeliveryTransport,
} from '../services/notifications/notificationDeliveryExecution.service.js';

let running = false;
let stopped = true;
let timer: ReturnType<typeof setTimeout> | null = null;
let activeCycle: Promise<void> | null = null;
let stopPromise: Promise<void> | null = null;

async function runCycle(transport: DeliveryTransport): Promise<void> {
  // Claim just-in-time rather than reserving the whole cycle's batch.
  //
  // If 25 rows were claimed up front and provider calls were processed
  // sequentially, later claims could expire before this process reached them.
  // Another process could then reclaim one of those rows and invoke the
  // provider concurrently.
  //
  // DB claim/fencing remains the cross-process correctness boundary; the
  // batch size here is only the maximum number of deliveries this cycle may
  // process.
  for (
    let processed = 0;
    processed < NOTIFICATION_DELIVERY_BATCH_SIZE;
    processed += 1
  ) {
    if (stopped) return;
    const [locator] = await claimNotificationDeliveries({
      limit: 1,
      leaseSeconds: NOTIFICATION_DELIVERY_LEASE_SECONDS,
    });

    if (!locator) return;

    try {
      await executeClaimedNotificationDelivery({ locator, transport });
    } catch (err) {
      console.error('[NOTIFICATION_DELIVERY_WORKER_ROW_FAILED]', {
        deliveryId: locator.delivery_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function schedule(transport: DeliveryTransport): void {
  if (stopped) return;

  timer = setTimeout(async () => {
    if (running) {
      schedule(transport);
      return;
    }

    running = true;

    const cycle = runCycle(transport);
    activeCycle = cycle;

    try {
      await cycle;
    } catch (err) {
      console.error(
        '[NOTIFICATION_DELIVERY_WORKER_CYCLE_FAILED]',
        err
      );
    } finally {
      if (activeCycle === cycle) {
        activeCycle = null;
      }

      running = false;
      schedule(transport);
    }
  }, NOTIFICATION_DELIVERY_POLL_INTERVAL_MS);
}

export function startNotificationDeliveryWorker(
  transport: DeliveryTransport,
): void {
  if (!stopped || stopPromise) return;

  stopped = false;
  schedule(transport);
}

export function stopNotificationDeliveryWorker(): Promise<void> {
  stopped = true;

  if (timer) clearTimeout(timer);
  timer = null;

  if (stopPromise) return stopPromise;

  const cycle = activeCycle;

  stopPromise = (async () => {
    if (!cycle) return;

    // The scheduled callback owns cycle-level error reporting.
    // Shutdown only waits for the active claimed work to settle.
    try {
      await cycle;
    } catch {
      // Already reported by schedule().
    }
  })().finally(() => {
    stopPromise = null;
  });

  return stopPromise;
}
