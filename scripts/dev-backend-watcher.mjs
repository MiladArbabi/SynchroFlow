/**
 * GH-1131-B — Backend development source watcher.
 *
 * Uses Node's built-in fs.watch.
 * No watcher starts when this module is imported.
 *
 * The supervisor owns build serialization.
 * This module only reports source changes.
 */

import { watch as fsWatch } from 'node:fs';

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
]);

function isRelevantSource(filename) {
  // Some platforms omit filenames from watch events.
  // Rebuild conservatively rather than miss a change.
  if (filename == null) return true;

  const name = String(filename).toLowerCase();

  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;

  return SOURCE_EXTENSIONS.has(name.slice(dot));
}

export function watchBackendSources({
  sourceDir,
  onChange,
  reportError,
  debounceMs = 150,
  watch = fsWatch,
}) {
  if (
    typeof sourceDir !== 'string' ||
    !sourceDir ||
    typeof onChange !== 'function' ||
    typeof reportError !== 'function' ||
    typeof watch !== 'function'
  ) {
    throw new TypeError('Invalid source watcher configuration');
  }

  if (
    !Number.isFinite(debounceMs) ||
    debounceMs < 0
  ) {
    throw new TypeError('Invalid source watcher debounce');
  }

  let closed = false;
  let timer = null;

  function notifyChange() {
    timer = null;

    if (closed) return;

    Promise.resolve()
      .then(() => {
        if (!closed) return onChange();
      })
      .catch(error => {
        if (!closed) reportError(error);
      });
  }

  function onWatchEvent(event, filename) {
    if (closed) return;

    if (!isRelevantSource(filename)) return;

    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(notifyChange, debounceMs);
  }

  // Recursive directory watching is supported by Node 20
  // on macOS, our current local development platform.
  const watcher = watch(
    sourceDir,
    { recursive: true },
    onWatchEvent
  );

  function onWatchError(error) {
    if (!closed) {
      reportError(error);
    }
  }

  watcher.on('error', onWatchError);

  function close() {
    if (closed) return;

    closed = true;

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    watcher.off?.('error', onWatchError);
    watcher.close();
  }

  return { close };
}
