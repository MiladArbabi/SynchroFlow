/**
 * GH-1131-B — Real backend development entry-point adapter.
 *
 * Connects database TCP readiness, backend paths,
 * process spawning and source watching to the
 * verified development application assembly.
 *
 * Importing this module starts nothing.
 */

import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import {
  createBackendDevApplication
} from './dev-backend-app.mjs';

import {
  createBackendProcessAdapter
} from './dev-backend-processes.mjs';

import {
  watchBackendSources
} from './dev-backend-watcher.mjs';

const DEFAULT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

function abortError() {
  const error = new Error('Database readiness cancelled');
  error.name = 'AbortError';
  return error;
}

function delayWithAbort(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise((resolve, reject) => {
    let timer;

    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };

    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

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

function probeTcpPort({
  host,
  port,
  signal,
  connectTimeoutMs
}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });

    let completed = false;
    let timeout;

    const complete = error => {
      if (completed) return;

      completed = true;

      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);

      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    const onAbort = () => complete(abortError());

    socket.once('connect', () => complete());
    socket.once('error', complete);

    timeout = setTimeout(() => {
      complete(new Error('Database TCP connection timed out'));
    }, connectTimeoutMs);

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

/**
 * Mirrors the existing local TCP:5432 readiness gate.
 * Retries connection failures until the port is available
 * or the supervisor requests shutdown.
 */
export async function waitForDatabasePort({
  host = '127.0.0.1',
  port = 5432,
  signal,
  retryMs = 250,
  connectTimeoutMs = 2000
} = {}) {
  if (
    typeof host !== 'string' ||
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isFinite(retryMs) ||
    retryMs <= 0 ||
    !Number.isFinite(connectTimeoutMs) ||
    connectTimeoutMs <= 0
  ) {
    throw new TypeError(
      'Invalid database TCP readiness configuration'
    );
  }

  while (true) {
    if (signal?.aborted) {
      throw abortError();
    }

    try {
      await probeTcpPort({
        host,
        port,
        signal,
        connectTimeoutMs
      });

      return;

    } catch (error) {
      if (
        signal?.aborted ||
        error?.name === 'AbortError'
      ) {
        throw abortError();
      }

      // Database unavailable: retry without starting
      // the compiler, API or worker.
    }

    await delayWithAbort(retryMs, signal);
  }
}

/**
 * Creates the fully connected backend development
 * application without starting it.
 */
export function createBackendDevEntrypoint({
  repoRoot = DEFAULT_ROOT,
  signals = process,

  waitForDatabase = signal =>
    waitForDatabasePort({ signal }),

  makeProcessAdapter = createBackendProcessAdapter,
  makeWatcher = watchBackendSources,

  reportError = error => console.error(error),

  onExit = code => {
    process.exitCode = code;
  }
} = {}) {
  if (
    typeof repoRoot !== 'string' ||
    !repoRoot ||
    typeof waitForDatabase !== 'function' ||
    typeof makeProcessAdapter !== 'function' ||
    typeof makeWatcher !== 'function'
  ) {
    throw new TypeError(
      'Invalid development entry-point configuration'
    );
  }

  const backendDir = path.resolve(
    repoRoot,
    'apps/backend'
  );

  const sourceDir = path.resolve(
    backendDir,
    'src'
  );

  return createBackendDevApplication({
    signals,
    waitForDatabase,

    makeProcessAdapter({ onUnexpectedExit }) {
      return makeProcessAdapter({
        backendDir,
        onUnexpectedExit
      });
    },

    watchSources(onChange, onWatcherError) {
      return makeWatcher({
        sourceDir,
        onChange,
        reportError: onWatcherError
      });
    },

    reportError,
    onExit
  });
}
