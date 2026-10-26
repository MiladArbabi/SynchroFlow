import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.resolve('scripts/dev-backend-cli.mjs')
).href;

async function fixture() {
  const { createBackendDevCli } = await import(moduleUrl);

  const signals = new EventEmitter();
  const events = [];

  const runtime = {
    async start() {
      events.push('runtime:start');
    },

    async shutdown() {
      events.push('runtime:shutdown');
    }
  };

  const cli = createBackendDevCli({
    runtime,
    signals,

    onExit(code) {
      events.push(`exit:${code}`);
    },

    reportError(error) {
      events.push(`error:${error.message}`);
    }
  });

  return { cli, signals, events };
}

test('SIGTERM shuts down runtime and returns success', async () => {
  const f = await fixture();

  await f.cli.start();

  f.signals.emit('SIGTERM');

  await f.cli.shutdown();

  assert.deepEqual(f.events, [
    'runtime:start',
    'runtime:shutdown',
    'exit:0'
  ]);

  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
  assert.equal(f.signals.listenerCount('SIGINT'), 0);
});

test('watcher failure shuts down and returns failure', async () => {
  const f = await fixture();

  await f.cli.start();

  await f.cli.onWatcherFailure(
    new Error('WATCHER_FAILED')
  );

  assert.deepEqual(f.events, [
    'runtime:start',
    'error:WATCHER_FAILED',
    'runtime:shutdown',
    'exit:1'
  ]);
});

test('unexpected worker exit stops remaining services', async () => {
  const f = await fixture();

  await f.cli.start();

  await f.cli.onUnexpectedServiceExit(
    'worker',
    17,
    null
  );

  assert.equal(
    f.events.filter(x => x === 'runtime:shutdown').length,
    1
  );

  assert.ok(
    f.events.some(x => x.startsWith('error:'))
  );

  assert.equal(f.events.at(-1), 'exit:1');
});

test('simultaneous shutdown requests stop runtime once', async () => {
  const f = await fixture();

  await f.cli.start();

  await Promise.all([
    f.cli.shutdown(),
    f.cli.shutdown(),
    f.cli.onWatcherFailure(
      new Error('WATCHER_FAILED')
    )
  ]);

  assert.equal(
    f.events.filter(x => x === 'runtime:shutdown').length,
    1
  );

  assert.equal(
    f.events.filter(x => x.startsWith('exit:')).length,
    1
  );

  assert.ok(f.events.includes('exit:1'));
});

test('normal startup keeps watching without shutdown', async () => {
  const f = await fixture();

  await f.cli.start();

  assert.deepEqual(f.events, ['runtime:start']);

  await f.cli.shutdown();
});
