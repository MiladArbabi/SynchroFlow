import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const url = pathToFileURL(
  path.resolve('scripts/dev-backend-entry.mjs')
).href;

async function fixture() {
  const { createBackendDevEntrypoint } = await import(url);

  const events = [];
  const signals = new EventEmitter();

  let watcherError;

  const app = createBackendDevEntrypoint({
    repoRoot: '/isolated/repository',
    signals,

    async waitForDatabase(signal) {
      assert.equal(typeof signal?.aborted, 'boolean');
      events.push('database:ready');
    },

    makeProcessAdapter({ backendDir }) {
      assert.equal(
        backendDir,
        '/isolated/repository/apps/backend'
      );

      return {
        async compile() {
          events.push('compile');
        },

        async startService(name) {
          events.push(`start:${name}`);
          return { name };
        },

        async stopService(child) {
          events.push(`stop:${child.name}`);
        }
      };
    },

    makeWatcher({ sourceDir, onChange, reportError }) {
      assert.equal(
        sourceDir,
        '/isolated/repository/apps/backend/src'
      );

      assert.equal(typeof onChange, 'function');

      watcherError = reportError;
      events.push('watch:open');

      return {
        close() {
          events.push('watch:close');
        }
      };
    },

    reportError(error) {
      events.push(`error:${error.message}`);
    },

    onExit(code) {
      events.push(`exit:${code}`);
    }
  });

  return {
    app,
    events,
    watcherFailure: error => watcherError(error)
  };
}

test('entry connects one compiler to both backend services', async () => {
  const f = await fixture();

  await f.app.start();

  assert.deepEqual(f.events, [
    'database:ready',
    'watch:open',
    'compile',
    'start:api',
    'start:worker'
  ]);

  await f.app.shutdown();

  assert.equal(
    f.events.filter(x => x === 'compile').length,
    1
  );

  assert.equal(f.events.at(-1), 'exit:0');
});

test('entry forwards watcher failures into shutdown', async () => {
  const f = await fixture();

  await f.app.start();

  await f.watcherFailure(
    new Error('ENTRY_WATCHER_FAILURE')
  );

  assert.ok(
    f.events.includes('error:ENTRY_WATCHER_FAILURE')
  );

  assert.ok(f.events.includes('stop:api'));
  assert.ok(f.events.includes('stop:worker'));
  assert.ok(f.events.includes('watch:close'));

  assert.equal(f.events.at(-1), 'exit:1');
});

test('TCP readiness succeeds against a disposable listener', {
  timeout: 3000
}, async () => {
  const { waitForDatabasePort } = await import(url);

  const server = net.createServer(socket => {
    socket.end();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    await waitForDatabasePort({
      host: '127.0.0.1',
      port: server.address().port,
      signal: new AbortController().signal,
      retryMs: 20
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('TCP readiness stops retrying after cancellation', {
  timeout: 3000
}, async () => {
  const { waitForDatabasePort } = await import(url);

  const server = net.createServer();

  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = server.address().port;

  await new Promise(resolve => server.close(resolve));

  const controller = new AbortController();

  const waiting = waitForDatabasePort({
    host: '127.0.0.1',
    port,
    signal: controller.signal,
    retryMs: 20
  });

  // Attach the rejection handler before requesting abort.
  const result = assert.rejects(
    waiting,
    error => error?.name === 'AbortError'
  );

  controller.abort();

  await result;
});
