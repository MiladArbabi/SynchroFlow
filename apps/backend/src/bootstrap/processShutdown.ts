export const PROCESS_SHUTDOWN_DEADLINE_MS = 10_000;

type ShutdownCleanup = {
  name: string;
  run: () => Promise<void> | void;
};

type ProcessShutdownOptions = {
  processName: string;
  startDrain: () => Promise<void>[];
  cleanup: ShutdownCleanup[];
  terminate?: (code: number) => void;
};

const deadlineError = (processName: string) =>
  new Error(
    `[${processName}] shutdown exceeded ${PROCESS_SHUTDOWN_DEADLINE_MS}ms deadline`
  );

function withinDeadline<T>(
  promise: Promise<T>,
  deadlineAt: number,
  processName: string
): Promise<T> {
  const remainingMs = deadlineAt - Date.now();

  if (remainingMs <= 0) {
    // The operation has already been requested. Consume a later rejection so
    // forced shutdown does not create an unhandled rejection after exit.
    void promise.catch(() => undefined);
    return Promise.reject(deadlineError(processName));
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(deadlineError(processName));
    }, remainingMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function createProcessShutdown(
  options: ProcessShutdownOptions
): (signal?: string) => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;

  return (signal?: string): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    const deadlineAt = Date.now() + PROCESS_SHUTDOWN_DEADLINE_MS;
    const terminate =
      options.terminate ??
      ((code: number) => {
        process.exit(code);
      });

    shutdownPromise = (async (): Promise<void> => {
      let failed = false;

      console.log(
        `[${options.processName}] shutdown triggered`,
        signal ?? ''
      );

      let drainResults: PromiseSettledResult<void>[] = [];

      try {
        // startDrain() must request every drain before this await.
        drainResults = await withinDeadline(
          Promise.allSettled(options.startDrain()),
          deadlineAt,
          options.processName
        );
      } catch (error) {
        // Promise.allSettled() itself cannot reject. Reaching this catch means
        // either startDrain() threw synchronously or the shared shutdown
        // deadline expired. In either case we must not tear down shared
        // infrastructure underneath potentially active work.
        console.error(
          `[${options.processName}] shutdown drain failed`,
          error
        );
        terminate(1);
        return;
      }

      for (const result of drainResults) {
        if (result.status === 'rejected') {
          failed = true;
          console.error(
            `[${options.processName}] shutdown drain rejected`,
            result.reason
          );
        }
      }

      // Infrastructure remains available until registered work has drained.
      // Cleanup still shares the original process-level deadline.
      for (const step of options.cleanup) {
        // Never start another teardown step after the shared process deadline.
        if (Date.now() >= deadlineAt) {
          console.error(
            `[${options.processName}] shutdown cleanup failed: ${step.name}`,
            deadlineError(options.processName)
          );
          terminate(1);
          return;
        }

        const requested = Promise.resolve().then(step.run);

        try {
          await withinDeadline(
            requested,
            deadlineAt,
            options.processName
          );
        } catch (error) {
          failed = true;
          console.error(
            `[${options.processName}] shutdown cleanup failed: ${step.name}`,
            error
          );

          // A timeout is terminal. Do not start later cleanup steps after the
          // original process-level deadline has expired.
          if (Date.now() >= deadlineAt) {
            terminate(1);
            return;
          }
        }
      }

      terminate(failed ? 1 : 0);
    })();

    return shutdownPromise;
  };
}
