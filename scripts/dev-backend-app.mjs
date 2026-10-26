/**
 * GH-1131-B — Backend development application assembly.
 *
 * Connects the shared supervisor, runtime and CLI.
 * No compilation, watching or process startup on import.
 */

import {
  createBackendSupervisor
} from './dev-backend-supervisor.mjs';

import {
  createBackendDevRuntime
} from './dev-backend-runtime.mjs';

import {
  createBackendDevCli
} from './dev-backend-cli.mjs';

export function createBackendDevApplication({
  signals = process,
  waitForDatabase,
  makeProcessAdapter,
  watchSources,
  reportError = error => console.error(error),
  onExit = code => {
    process.exitCode = code;
  },
} = {}) {
  if (
    typeof waitForDatabase !== 'function' ||
    typeof makeProcessAdapter !== 'function' ||
    typeof watchSources !== 'function' ||
    typeof reportError !== 'function' ||
    typeof onExit !== 'function'
  ) {
    throw new TypeError(
      'Invalid development application hooks'
    );
  }

  let cli;

  // Unexpected child exits are fatal to the development
  // session: stop the sibling and close the watcher.
  const adapter = makeProcessAdapter({
    onUnexpectedExit(name, code, signal) {
      return cli.onUnexpectedServiceExit(
        name,
        code,
        signal
      );
    }
  });

  if (
    !adapter ||
    typeof adapter.compile !== 'function' ||
    typeof adapter.startService !== 'function' ||
    typeof adapter.stopService !== 'function'
  ) {
    throw new TypeError(
      'Invalid development process adapter'
    );
  }

  const supervisor = createBackendSupervisor({
    compile: adapter.compile,
    startService: adapter.startService,
    stopService: adapter.stopService,
  });

  const runtime = createBackendDevRuntime({
    supervisor,
    waitForDatabase,

    // Watcher errors must reach the CLI shutdown path.
    // Logging alone would leave stale services running.
    watchSources(onChange) {
      return watchSources(
        onChange,
        error => cli.onWatcherFailure(error)
      );
    },

    // Compilation failures remain recoverable:
    // services stay stopped until a successful rebuild.
    reportError,
  });

  cli = createBackendDevCli({
    runtime,
    signals,
    reportError,
    onExit,
  });

  return {
    start: () => cli.start(),
    shutdown: () => cli.shutdown(),
  };
}
