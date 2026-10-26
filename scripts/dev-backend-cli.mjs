/**
 * GH-1131-B — Development CLI lifecycle coordination.
 *
 * Owns signal listeners, failure escalation, and one-time shutdown.
 * No services or listeners start when this module is imported.
 */

export function createBackendDevCli({
  runtime,
  signals = process,
  onExit = code => {
    process.exitCode = code;
  },
  reportError = error => console.error(error),
} = {}) {
  if (
    !runtime ||
    typeof runtime.start !== 'function' ||
    typeof runtime.shutdown !== 'function' ||
    typeof signals.on !== 'function' ||
    typeof signals.off !== 'function' ||
    typeof onExit !== 'function' ||
    typeof reportError !== 'function'
  ) {
    throw new TypeError('Invalid backend CLI hooks');
  }

  let started = false;
  let failed = false;
  let shutdownJob = null;

  function report(error) {
    try {
      reportError(error);
    } catch (reportingError) {
      console.error(
        '[dev-backend] Failure reporter threw:',
        reportingError
      );
    }
  }

  function detachSignals() {
    signals.off('SIGINT', onSignal);
    signals.off('SIGTERM', onSignal);
  }

  function requestShutdown(exitCode = 0) {
    // A failure must take precedence over an overlapping
    // clean shutdown request.
    if (exitCode !== 0) {
      failed = true;
    }

    if (shutdownJob) {
      return shutdownJob;
    }

    shutdownJob = (async () => {
      detachSignals();

      try {
        await runtime.shutdown();
      } catch (error) {
        failed = true;
        report(error);
      }

      // Do not call process.exit(): allow the runtime to
      // drain its children before setting the final status.
      onExit(failed ? 1 : 0);
    })();

    return shutdownJob;
  }

  function onSignal() {
    // requestShutdown owns failure handling and completion.
    void requestShutdown(0);
  }

  async function start() {
    if (started) {
      throw new Error('Development CLI already started');
    }

    if (shutdownJob) {
      throw new Error('Development CLI already shut down');
    }

    started = true;

    // Register before startup so signals are handled even
    // while the initial compiler or DB readiness is pending.
    signals.on('SIGINT', onSignal);
    signals.on('SIGTERM', onSignal);

    try {
      await runtime.start();
    } catch (error) {
      await onWatcherFailure(error);
    }
  }

  function shutdown() {
    return requestShutdown(0);
  }

  function onWatcherFailure(error) {
    failed = true;
    report(error);

    return requestShutdown(1);
  }

  function onUnexpectedServiceExit(name, code, signal) {
    return onWatcherFailure(
      new Error(
        `${name} exited unexpectedly ` +
        `(code=${code}, signal=${signal})`
      )
    );
  }

  return {
    start,
    shutdown,
    onWatcherFailure,
    onUnexpectedServiceExit,
  };
}
