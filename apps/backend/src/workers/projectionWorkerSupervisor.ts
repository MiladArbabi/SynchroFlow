type ProjectionWorkerStart = () => Promise<void>;

type ProjectionWorkerSupervisorOptions = {
  restartDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logFatal?: (error: unknown) => void;
  maxRestarts?: number;
  shouldStop?: () => boolean;
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
    shouldStop = () => false,
  } = options;

  let restartCount = 0;

  while (true) {
    try {
      await start();
      return;
    } catch (error) {
      if (shouldStop()) return;
      logFatal(error);

      if (restartCount >= maxRestarts) {
        throw error;
      }

      restartCount += 1;
      await sleep(restartDelayMs);
      if (shouldStop()) return;
    }
  }
}

/**
 * Runtime entrypoint.
 *
 * The dynamic import keeps projection-worker initialization lazy, matching
 * the existing worker transport boot behavior.
 */
let shutdownRequested = false;
let supervisorPromise: Promise<void> | null = null;
let activeStop: (() => Promise<void>) | null = null;
let wakeRestartDelay: (() => void) | null = null;

function restartDelayOrStop(ms: number): Promise<void> {
  if (shutdownRequested) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wakeRestartDelay = null;
      resolve();
    }, ms);
    wakeRestartDelay = () => {
      clearTimeout(timer);
      wakeRestartDelay = null;
      resolve();
    };
  });
}

export function startProjectionWorkerSupervisor(): Promise<void> {
  if (supervisorPromise) return supervisorPromise;

  shutdownRequested = false;
  const run = (async () => {
    const projection = await import('./projection.db.worker.js');
    if (shutdownRequested) return;
    activeStop = projection.stopDbProjectionWorker;
    const supervisedRun = superviseProjectionWorker(
      () => projection.startDbProjectionWorker(),
      {
        sleep: restartDelayOrStop,
        shouldStop: () => shutdownRequested,
      }
    );
    if (shutdownRequested) await activeStop();
    await supervisedRun;
  })();

  const ownedRun = run.finally(() => {
    activeStop = null;
    wakeRestartDelay = null;
    if (supervisorPromise === ownedRun) supervisorPromise = null;
  });
  supervisorPromise = ownedRun;
  return ownedRun;
}

export async function stopProjectionWorkerSupervisor(): Promise<void> {
  shutdownRequested = true;
  wakeRestartDelay?.();
  const stop = activeStop;
  if (stop) await stop();
  const activeSupervisor = supervisorPromise;
  if (activeSupervisor) await activeSupervisor;
}
