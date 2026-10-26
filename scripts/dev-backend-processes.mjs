/**
 * GH-1131-B — Backend development process adapter.
 *
 * No compilation or service startup on import.
 * All spawned processes are explicitly owned.
 */

import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

export function createBackendProcessAdapter({
  spawn = nodeSpawn,
  backendDir = path.resolve(process.cwd(), 'apps/backend'),
  nodeExecutable = process.execPath,
  npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm',
  onUnexpectedExit = (name, code, signal) => {
    console.error(
      `[dev-backend] ${name} exited unexpectedly ` +
      `(code=${code}, signal=${signal})`
    );
  },
  stopTimeoutMs = 10000,
  killTimeoutMs = 3000,
} = {}) {
  if (
    typeof spawn !== 'function' ||
    typeof onUnexpectedExit !== 'function'
  ) {
    throw new TypeError('Invalid process adapter hooks');
  }

  if (
    ![stopTimeoutMs, killTimeoutMs].every(
      value => Number.isFinite(value) && value > 0
    )
  ) {
    throw new TypeError(
      'Process shutdown timeouts must be positive'
    );
  }

  const serviceStates = new WeakMap();

  const spawnOptions = () => ({
    cwd: backendDir,
    stdio: 'inherit',
    env: process.env,
  });

  function compileAbortError() {
    const error = new Error('Backend compilation cancelled');
    error.name = 'AbortError';
    return error;
  }

  async function compile(signal) {
    if (signal?.aborted) {
      throw compileAbortError();
    }

    return new Promise((resolve, reject) => {
      // Own npm and its TypeScript descendants in one Unix group.
      // Injected test spawns use child.kill directly.
      const groupOwned =
        spawn === nodeSpawn && process.platform !== 'win32';

      let child;

      try {
        child = spawn(
          npmExecutable,
          ['run', 'build:dev'],
          {
            ...spawnOptions(),
            ...(groupOwned ? { detached: true } : {})
          }
        );
      } catch (error) {
        reject(error);
        return;
      }

      let settled = false;
      let abortRequested = false;
      let escalationTimer = null;
      let confirmationTimer = null;

      function sendSignal(name) {
        try {
          if (
            groupOwned &&
            Number.isInteger(child.pid) &&
            child.pid > 0
          ) {
            process.kill(-child.pid, name);
            return true;
          }

          return child.kill(name);
        } catch (error) {
          if (error?.code !== 'ESRCH') {
            console.error(
              '[dev-backend] Compiler signal failed:',
              error
            );
          }
          return false;
        }
      }

      function cleanup() {
        clearTimeout(escalationTimer);
        clearTimeout(confirmationTimer);
        signal?.removeEventListener('abort', onAbort);
      }

      function finish(error = null) {
        if (settled) return;
        settled = true;
        cleanup();

        // A completed npm leader does not by itself prove
        // that all its TypeScript descendants have exited.
        if (abortRequested && groupOwned) {
          try {
            if (
              Number.isInteger(child.pid) &&
              child.pid > 0
            ) {
              process.kill(-child.pid, 'SIGKILL');
            }
          } catch (killError) {
            if (killError?.code !== 'ESRCH') {
              error = new Error(
                'Compiler group cleanup failed: ' +
                killError.message
              );
            }
          }
        }

        if (error) reject(error);
        else resolve();
      }

      function onAbort() {
        if (settled || abortRequested) return;

        abortRequested = true;
        sendSignal('SIGTERM');

        escalationTimer = setTimeout(() => {
          if (settled) return;

          sendSignal('SIGKILL');

          confirmationTimer = setTimeout(() => {
            finish(
              new Error(
                'Compiler termination was not confirmed'
              )
            );
          }, killTimeoutMs);
        }, stopTimeoutMs);
      }

      child.once('error', error => {
        finish(
          abortRequested ? compileAbortError() : error
        );
      });

      child.once('close', (code, exitSignal) => {
        if (abortRequested || signal?.aborted) {
          finish(compileAbortError());
        } else if (code === 0) {
          finish();
        } else {
          finish(
            new Error(
              'Backend compilation failed ' +
              '(code=' + code +
              ', signal=' + exitSignal + ')'
            )
          );
        }
      });

      signal?.addEventListener(
        'abort',
        onAbort,
        { once: true }
      );

      if (signal?.aborted) {
        onAbort();
      }
    });
  }

  async function startService(name) {
    const args = {
      api: ['./scripts/node-start.js'],
      worker: ['dist/worker-entry.js'],
    }[name];

    if (!args) {
      throw new Error(`Unknown backend service: ${name}`);
    }

    return new Promise((resolve, reject) => {
      let child;

      try {
        child = spawn(
          nodeExecutable,
          args,
          spawnOptions()
        );
      } catch (error) {
        reject(error);
        return;
      }

      const state = {
        name,
        closed: false,
        stopping: false,
        stopPromise: null,
        exitPromise: null,
      };

      let completeExit;

      state.exitPromise = new Promise(done => {
        completeExit = done;
      });

      serviceStates.set(child, state);

      let launched = false;

      child.once('spawn', () => {
        launched = true;
        resolve(child);
      });

      child.on('error', error => {
        if (!launched) {
          reject(error);
        } else {
          console.error(
            `[dev-backend] ${name} process error:`,
            error
          );
        }
      });

      child.once('close', (code, signal) => {
        state.closed = true;
        completeExit({ code, signal });

        if (!launched) {
          reject(
            new Error(
              `${name} terminated before starting ` +
              `(code=${code}, signal=${signal})`
            )
          );
        } else if (!state.stopping) {
          try {
            onUnexpectedExit(name, code, signal);
          } catch (reportError) {
            console.error(
              '[dev-backend] Exit reporter failed:',
              reportError
            );
          }
        }
      });
    });
  }

  function waitForClose(state, timeout) {
    if (state.closed) {
      return Promise.resolve(true);
    }

    return new Promise(resolve => {
      const timer = setTimeout(
        () => resolve(false),
        timeout
      );

      state.exitPromise.then(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async function stopService(child) {
    const state = serviceStates.get(child);

    if (!state) {
      throw new TypeError(
        'Unknown backend child process'
      );
    }

    if (state.closed) return;
    if (state.stopPromise) return state.stopPromise;

    state.stopping = true;

    const operation = (async () => {
      if (
        !child.kill('SIGTERM') &&
        !state.closed
      ) {
        throw new Error(
          `Unable to signal ${state.name} for shutdown`
        );
      }

      if (await waitForClose(state, stopTimeoutMs)) {
        return;
      }

      if (
        !child.kill('SIGKILL') &&
        !state.closed
      ) {
        throw new Error(
          `Unable to force-stop ${state.name}`
        );
      }

      if (
        !(await waitForClose(state, killTimeoutMs))
      ) {
        throw new Error(
          `${state.name} failed to exit after SIGKILL`
        );
      }
    })();

    state.stopPromise = operation;

    try {
      return await operation;
    } catch (error) {
      // Keep failed shutdowns retryable.
      state.stopping = false;
      throw error;
    } finally {
      state.stopPromise = null;
    }
  }

  return {
    compile,
    startService,
    stopService,
  };
}
