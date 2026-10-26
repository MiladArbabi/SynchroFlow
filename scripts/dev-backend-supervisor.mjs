/**
 * GH-1131-B — Backend development supervisor core.
 *
 * Owns build serialization and service lifecycle.
 * Runtime watching and process spawning are wired separately.
 *
 * Importing this module performs no compilation or startup.
 */

export function createBackendSupervisor({
  compile,
  startService,
  stopService,
}) {
  if (
    typeof compile !== 'function' ||
    typeof startService !== 'function' ||
    typeof stopService !== 'function'
  ) {
    throw new TypeError('Supervisor hooks must be functions');
  }

  const active = [];

  let queue = Promise.resolve();
  let started = false;
  let closed = false;
  let activeCompile = null;

  let rebuildJob = null;
  let rebuildPending = false;

  function exclusive(work) {
    const current = queue.then(work);

    queue = current.then(
      () => undefined,
      () => undefined
    );

    return current;
  }

  async function stopActive() {
    const stopping = [...active];

    const results = await Promise.allSettled(
      stopping.map(child =>
        Promise.resolve().then(() => stopService(child))
      )
    );

    const failures = [];
    const failedChildren = [];

    for (let index = 0; index < results.length; index++) {
      if (results[index].status === 'rejected') {
        failures.push(results[index].reason);
        failedChildren.push(stopping[index]);
      }
    }

    // Retain processes whose shutdown was not confirmed.
    active.splice(0, active.length, ...failedChildren);

    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Unable to stop all backend services'
      );
    }
  }

  async function compileAndStart() {
    // Never modify compiled output while old services are running.
    await stopActive();

    if (closed) return;

    // Aborting compilation prevents startup after shutdown.
    const controller = new AbortController();
    activeCompile = controller;

    try {
      await compile(controller.signal);
    } catch (error) {
      if (
        closed &&
        controller.signal.aborted &&
        error?.name === 'AbortError'
      ) {
        return;
      }
      throw error;
    } finally {
      if (activeCompile === controller) {
        activeCompile = null;
      }
    }

    if (closed) return;

    try {
      for (const name of ['api', 'worker']) {
        if (closed) break;

        const child = await startService(name);
        active.push(child);
      }
    } catch (error) {
      // Do not leave a partially started backend.
      try {
        await stopActive();
      } catch (stopError) {
        throw new AggregateError(
          [error, stopError],
          'Service startup and cleanup failed'
        );
      }

      throw error;
    }

    if (closed) {
      await stopActive();
    }
  }

  function start() {
    return exclusive(async () => {
      if (closed) {
        throw new Error('Supervisor is shut down');
      }

      if (started) {
        throw new Error('Supervisor already started');
      }

      started = true;
      await compileAndStart();
    });
  }

  function rebuild() {
    if (closed) {
      return Promise.reject(
        new Error('Supervisor is shut down')
      );
    }

    // Multiple changes during a build request one additional pass.
    if (rebuildJob) {
      rebuildPending = true;
      return rebuildJob;
    }

    const current = exclusive(async () => {
      if (!started) {
        throw new Error('Supervisor has not started');
      }

      do {
        rebuildPending = false;
        await compileAndStart();
      } while (rebuildPending && !closed);
    });

    rebuildJob = current;

    const clearJob = () => {
      if (rebuildJob === current) {
        rebuildJob = null;
      }
    };

    current.then(clearJob, clearJob);

    return current;
  }

  function shutdown() {
    closed = true;
    activeCompile?.abort();
    return exclusive(stopActive);
  }

  return { start, rebuild, shutdown };
}


// GH-1131-B EXECUTABLE MODE
//
// The supervisor core remains import-safe.
// Only direct execution activates the development CLI.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function runBackendDevelopmentCommand() {
  const args = process.argv.slice(2);

  // Reject unknown arguments before loading startup modules.
  if (
    args.length > 1 ||
    (args.length === 1 && args[0] !== '--check')
  ) {
    console.error(
      'Usage: node scripts/dev-backend-supervisor.mjs [--check]'
    );
    process.exitCode = 2;
    return;
  }

  try {
    const {
      createBackendDevEntrypoint,
      waitForDatabasePort
    } = await import('./dev-backend-entry.mjs');

    if (
      typeof createBackendDevEntrypoint !== 'function' ||
      typeof waitForDatabasePort !== 'function'
    ) {
      throw new Error(
        'Backend development entry-point exports are invalid'
      );
    }

    // Import and validate the startup adapter, but do not
    // compile, watch, connect to PostgreSQL or spawn services.
    if (args[0] === '--check') {
      console.log('GH1131_B_EXECUTABLE_CHECK=PASS');
      return;
    }

    // Normal execution is activated only when invoked directly
    // without arguments, never when this module is imported.
    const app = createBackendDevEntrypoint();

    await app.start();

  } catch (error) {
    console.error(
      '[dev-backend] Executable startup failed:',
      error
    );
    process.exitCode = 1;
  }
}

const directlyExecuted =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(path.resolve(process.argv[1])).href ===
    import.meta.url;

if (directlyExecuted) {
  void runBackendDevelopmentCommand();
}
