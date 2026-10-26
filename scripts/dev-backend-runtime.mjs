/**
 * GH-1131-B — Backend development runtime coordinator.
 *
 * Coordinates database readiness, source watching,
 * compilation lifecycle, recovery and shutdown.
 *
 * All external effects are injected.
 * Importing this module starts no services.
 */

export function createBackendDevRuntime({
  supervisor,
  waitForDatabase,
  watchSources,
  reportError,
}) {
  if (
    !supervisor ||
    typeof supervisor.start !== 'function' ||
    typeof supervisor.rebuild !== 'function' ||
    typeof supervisor.shutdown !== 'function' ||
    typeof waitForDatabase !== 'function' ||
    typeof watchSources !== 'function' ||
    typeof reportError !== 'function'
  ) {
    throw new TypeError('Invalid backend runtime hooks');
  }

  let started = false;
  let closed = false;
  let watcher = null;
  const databaseWaitAbort = new AbortController();

  function onSourceChange() {
    if (closed) {
      return Promise.resolve();
    }

    return Promise.resolve()
      .then(() => {
        if (!closed) {
          return supervisor.rebuild();
        }
      })
      .catch(error => {
        reportError(error);
      });
  }

  async function start() {
    if (closed) {
      throw new Error('Runtime already shut down');
    }

    if (started) {
      throw new Error('Runtime already started');
    }

    started = true;

    // Do not compile/start the backend before DB readiness.
    try {
      await waitForDatabase(databaseWaitAbort.signal);
    } catch (error) {
      // Cancellation during shutdown is expected.
      if (closed && databaseWaitAbort.signal.aborted) {
        return;
      }
      throw error;
    }

    if (closed) return;

    // Watch before initial compilation so changes are not lost.
    watcher = await watchSources(onSourceChange);

    if (closed) {
      await watcher?.close?.();
      return;
    }

    try {
      await supervisor.start();
    } catch (error) {
      // Keep watching after a failed compilation.
      // The next source edit can trigger recovery.
      reportError(error);
    }
  }

  async function shutdown() {
    closed = true;
    databaseWaitAbort.abort();

    try {
      await watcher?.close?.();
    } finally {
      // Always attempt service shutdown, including when
      // closing the filesystem watcher fails.
      await supervisor.shutdown();
    }
  }

  return {
    start,
    shutdown,
  };
}
