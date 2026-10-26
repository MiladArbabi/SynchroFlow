import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const url = pathToFileURL(
  path.resolve('scripts/dev-backend-app.mjs')
).href;

async function fixture({ failCompile = false } = {}) {
  const { createBackendDevApplication } = await import(url);

  const events = [];
  const signals = new EventEmitter();

  let triggerChange;
  let triggerWatcherFailure;
  let triggerUnexpectedExit;
  let failNextCompile = failCompile;

  const app = createBackendDevApplication({
    signals,

    async waitForDatabase() {
      events.push('database:ready');
    },

    makeProcessAdapter({ onUnexpectedExit }) {
      triggerUnexpectedExit = onUnexpectedExit;

      return {
        async compile() {
          events.push('compile');

          if (failNextCompile) {
            failNextCompile = false;
            throw new Error('EXPECTED_COMPILER_FAILURE');
          }
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

    watchSources(onChange, onWatcherError) {
      triggerChange = onChange;
      triggerWatcherFailure = onWatcherError;
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
    signals,
    change: () => triggerChange(),
    watcherFailure: error => triggerWatcherFailure(error),
    unexpectedExit: (name, code, signal) =>
      triggerUnexpectedExit(name, code, signal)
  };
}

test('one compiler serves both processes; edits rebuild both', async () => {
  const f = await fixture();

  await f.app.start();

  assert.deepEqual(f.events, [
    'database:ready',
    'watch:open',
    'compile',
    'start:api',
    'start:worker'
  ]);

  await f.change();

  assert.deepEqual(f.events.slice(5), [
    'stop:api',
    'stop:worker',
    'compile',
    'start:api',
    'start:worker'
  ]);

  await f.app.shutdown();

  assert.equal(f.events.at(-1), 'exit:0');
});

test('watcher error shuts down both services and fails', async () => {
  const f = await fixture();

  await f.app.start();

  await f.watcherFailure(
    new Error('EXPECTED_WATCHER_FAILURE')
  );

  assert.ok(
    f.events.includes('error:EXPECTED_WATCHER_FAILURE')
  );

  assert.ok(f.events.includes('watch:close'));
  assert.ok(f.events.includes('stop:api'));
  assert.ok(f.events.includes('stop:worker'));

  assert.equal(f.events.at(-1), 'exit:1');
});

test('unexpected worker exit shuts down the API and fails', async () => {
  const f = await fixture();

  await f.app.start();

  await f.unexpectedExit('worker', 17, null);

  assert.ok(f.events.includes('stop:api'));
  assert.ok(f.events.includes('watch:close'));
  assert.equal(f.events.at(-1), 'exit:1');
});

test('initial compiler failure remains recoverable by an edit', async () => {
  const f = await fixture({ failCompile: true });

  await f.app.start();

  assert.ok(
    f.events.includes('error:EXPECTED_COMPILER_FAILURE')
  );

  assert.equal(
    f.events.some(x => x.startsWith('start:')),
    false
  );

  assert.equal(
    f.events.some(x => x.startsWith('exit:')),
    false
  );

  await f.change();

  assert.ok(f.events.includes('start:api'));
  assert.ok(f.events.includes('start:worker'));

  await f.app.shutdown();
  assert.equal(f.events.at(-1), 'exit:0');
});

test('SIGTERM stops watcher and services exactly once', async () => {
  const f = await fixture();

  await f.app.start();

  f.signals.emit('SIGTERM');

  await f.app.shutdown();
  await f.app.shutdown();

  assert.equal(
    f.events.filter(x => x === 'watch:close').length,
    1
  );

  assert.equal(
    f.events.filter(x => x === 'stop:api').length,
    1
  );

  assert.equal(
    f.events.filter(x => x === 'stop:worker').length,
    1
  );

  assert.deepEqual(
    f.events.filter(x => x.startsWith('exit:')),
    ['exit:0']
  );
});

test('watcher startup failure exits without starting services', async () => {
  const { createBackendDevApplication } = await import(url);

  const events = [];

  const app = createBackendDevApplication({
    signals: new EventEmitter(),

    async waitForDatabase() {},

    makeProcessAdapter() {
      return {
        async compile() {
          events.push('compile');
        },
        async startService() {
          events.push('service:start');
          return {};
        },
        async stopService() {}
      };
    },

    watchSources() {
      throw new Error('EXPECTED_WATCH_SETUP_FAILURE');
    },

    reportError(error) {
      events.push(`error:${error.message}`);
    },

    onExit(code) {
      events.push(`exit:${code}`);
    }
  });

  await app.start();

  assert.deepEqual(events, [
    'error:EXPECTED_WATCH_SETUP_FAILURE',
    'exit:1'
  ]);
});

async function createPausedCompilationFixture() {
  const { createBackendDevApplication } = await import(url);

  const signals = new EventEmitter();
  const events = [];

  let compilationEntered;
  const entered = new Promise(resolve => {
    compilationEntered = resolve;
  });

  let releaseCompilation;
  let watcherFailure;

  const app = createBackendDevApplication({
    signals,

    async waitForDatabase() {
      events.push('database:ready');
    },

    makeProcessAdapter() {
      return {
        async compile() {
          events.push('compile:entered');

          await new Promise(resolve => {
            releaseCompilation = resolve;
            compilationEntered();
          });

          events.push('compile:completed');
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

    watchSources(onChange, onError) {
      events.push('watch:open');
      watcherFailure = onError;

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
    signals,
    events,
    entered,

    release() {
      releaseCompilation();
    },

    watcherFailure(error) {
      return watcherFailure(error);
    }
  };
}

test('SIGTERM during compilation never starts services', {
  timeout: 3000
}, async () => {
  const f = await createPausedCompilationFixture();

  const starting = f.app.start();

  await f.entered;

  f.signals.emit('SIGTERM');
  f.release();

  await Promise.all([
    starting,
    f.app.shutdown()
  ]);

  assert.equal(
    f.events.some(x => x.startsWith('start:')),
    false
  );

  assert.equal(
    f.events.filter(x => x === 'watch:close').length,
    1
  );

  assert.deepEqual(
    f.events.filter(x => x.startsWith('exit:')),
    ['exit:0']
  );
});

test('watcher failure during compilation prevents service startup', {
  timeout: 3000
}, async () => {
  const f = await createPausedCompilationFixture();

  const starting = f.app.start();

  await f.entered;

  const failing = f.watcherFailure(
    new Error('WATCH_FAILED_DURING_COMPILE')
  );

  f.release();

  await Promise.all([starting, failing]);

  assert.equal(
    f.events.some(x => x.startsWith('start:')),
    false
  );

  assert.ok(
    f.events.includes('error:WATCH_FAILED_DURING_COMPILE')
  );

  assert.deepEqual(
    f.events.filter(x => x.startsWith('exit:')),
    ['exit:1']
  );
});

test('SIGTERM during database readiness never opens watcher', {
  timeout: 3000
}, async () => {
  const { createBackendDevApplication } = await import(url);

  const signals = new EventEmitter();
  const events = [];

  let waitEntered;
  const entered = new Promise(resolve => {
    waitEntered = resolve;
  });

  const app = createBackendDevApplication({
    signals,

    waitForDatabase(signal) {
      events.push('database:waiting');

      return new Promise(resolve => {
        signal.addEventListener('abort', () => {
          events.push('database:aborted');
          resolve();
        }, { once: true });

        waitEntered();
      });
    },

    makeProcessAdapter() {
      return {
        async compile() {
          events.push('compile');
        },

        async startService(name) {
          events.push(`start:${name}`);
          return { name };
        },

        async stopService() {}
      };
    },

    watchSources() {
      events.push('watch:open');
      return { close() {} };
    },

    reportError(error) {
      events.push(`error:${error.message}`);
    },

    onExit(code) {
      events.push(`exit:${code}`);
    }
  });

  const starting = app.start();

  await entered;

  signals.emit('SIGTERM');

  await Promise.all([
    starting,
    app.shutdown()
  ]);

  assert.deepEqual(events, [
    'database:waiting',
    'database:aborted',
    'exit:0'
  ]);
});
