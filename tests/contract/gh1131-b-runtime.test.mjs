import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.resolve('scripts/dev-backend-runtime.mjs')
).href;

async function fixture({ failInitialBuild = false } = {}) {
  const { createBackendDevRuntime } = await import(moduleUrl);

  const events = [];
  let notifyChange;
  let builds = 0;

  const supervisor = {
    async start() {
      builds++;
      events.push('supervisor:start');

      if (failInitialBuild && builds === 1) {
        throw new Error('EXPECTED_BUILD_FAILURE');
      }
    },

    async rebuild() {
      builds++;
      events.push('supervisor:rebuild');
    },

    async shutdown() {
      events.push('supervisor:shutdown');
    }
  };

  const runtime = createBackendDevRuntime({
    supervisor,

    async waitForDatabase() {
      events.push('database:ready');
    },

    watchSources(onChange) {
      events.push('watch:open');
      notifyChange = onChange;

      return {
        close() {
          events.push('watch:close');
        }
      };
    },

    reportError(error) {
      events.push(`error:${error.message}`);
    }
  });

  return {
    runtime,
    events,
    get notifyChange() {
      return notifyChange;
    }
  };
}

test('database readiness precedes watching and startup', async () => {
  const f = await fixture();

  await f.runtime.start();

  assert.deepEqual(f.events, [
    'database:ready',
    'watch:open',
    'supervisor:start'
  ]);

  await f.runtime.shutdown();
});

test('filesystem changes request a backend rebuild', async () => {
  const f = await fixture();

  await f.runtime.start();

  assert.equal(typeof f.notifyChange, 'function');

  await f.notifyChange();

  assert.ok(
    f.events.includes('supervisor:rebuild')
  );

  await f.runtime.shutdown();
});

test('initial compilation failure keeps watching for recovery', async () => {
  const f = await fixture({ failInitialBuild: true });

  await f.runtime.start();

  assert.ok(
    f.events.includes('error:EXPECTED_BUILD_FAILURE')
  );

  assert.equal(typeof f.notifyChange, 'function');

  await f.notifyChange();

  assert.ok(
    f.events.includes('supervisor:rebuild')
  );

  await f.runtime.shutdown();
});

test('shutdown closes watcher before stopping services', async () => {
  const f = await fixture();

  await f.runtime.start();
  await f.runtime.shutdown();

  const watchClose = f.events.indexOf('watch:close');
  const serviceStop = f.events.indexOf('supervisor:shutdown');

  assert.ok(watchClose >= 0);
  assert.ok(serviceStop > watchClose);
});

test('shutdown aborts a pending database readiness wait', {
  timeout: 2000
}, async () => {
  const { createBackendDevRuntime } = await import(moduleUrl);

  const events = [];

  let notifyWaitEntered;
  const waitEntered = new Promise(resolve => {
    notifyWaitEntered = resolve;
  });

  let receivedSignal;

  const runtime = createBackendDevRuntime({
    supervisor: {
      async start() {
        events.push('service:start');
      },
      async rebuild() {},
      async shutdown() {
        events.push('supervisor:shutdown');
      }
    },

    waitForDatabase(signal) {
      receivedSignal = signal;
      notifyWaitEntered();

      return new Promise((resolve, reject) => {
        // Before implementation, the missing signal leaves
        // the wait pending. The assertion below exposes it.
        if (!signal) return;

        const abort = () => {
          const error = new Error('Database wait aborted');
          error.name = 'AbortError';
          reject(error);
        };

        if (signal.aborted) {
          abort();
        } else {
          signal.addEventListener('abort', abort, {
            once: true
          });
        }
      });
    },

    watchSources() {
      events.push('watch:open');
      return { close() {} };
    },

    reportError(error) {
      events.push(`error:${error.message}`);
    }
  });

  const starting = runtime.start();

  await waitEntered;

  // This must cancel the database wait even when the
  // database never becomes available.
  await runtime.shutdown();

  assert.equal(
    receivedSignal?.aborted,
    true,
    'Database readiness wait must receive an aborted signal'
  );

  await starting;

  assert.deepEqual(events, [
    'supervisor:shutdown'
  ]);
});
