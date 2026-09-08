type ProjectionWorkerStart = () => Promise<void>;

type ProjectionWorkerSupervisorOptions = {
  restartDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logFatal?: (error: unknown) => void;
  maxRestarts?: number;
};

const DEFAULT_RESTART_DELAY_MS = 5_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultLogFatal = (error: unknown): void => {
  console.error(
    '[projection-worker-supervisor] projection worker stopped; restarting',
    error
  );
};

/**
 * GH-1052 — authoritative projection worker supervision.
 *
 * A projection fatal is intentionally allowed to terminate one worker run,
 * but it must not become an unowned rejection that leaves the process alive
 * with projection permanently stopped.
 *
 * Production retries indefinitely. Tests may bound retries with maxRestarts.
 */
export async function superviseProjectionWorker(
  start: ProjectionWorkerStart,
  options: ProjectionWorkerSupervisorOptions = {}
): Promise<void> {
  const {
    restartDelayMs = DEFAULT_RESTART_DELAY_MS,
    sleep = defaultSleep,
    logFatal = defaultLogFatal,
    maxRestarts = Number.POSITIVE_INFINITY,
  } = options;

  let restartCount = 0;

  while (true) {
    try {
      await start();
      return;
    } catch (error) {
      logFatal(error);

      if (restartCount >= maxRestarts) {
        throw error;
      }

      restartCount += 1;
      await sleep(restartDelayMs);
    }
  }
}

/**
 * Runtime entrypoint.
 *
 * The dynamic import keeps projection-worker initialization lazy, matching
 * the existing worker transport boot behavior.
 */
export async function startProjectionWorkerSupervisor(): Promise<void> {
  const { startDbProjectionWorker } = await import('./projection.db.worker.js');

  await superviseProjectionWorker(() => startDbProjectionWorker());
}
