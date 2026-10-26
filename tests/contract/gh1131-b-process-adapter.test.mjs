import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const url = pathToFileURL(
  path.resolve('scripts/dev-backend-processes.mjs')
).href;

function harness({ compileExit = 0 } = {}) {
  const calls = [];
  const exits = [];

  function spawn(command, args, options) {
    const child = new EventEmitter();

    child.pid = calls.length + 100;

    child.kill = signal => {
      calls.push({ signal, child, action: 'kill' });

      queueMicrotask(() => {
        child.emit('close', null, signal);
      });

      return true;
    };

    calls.push({ command, args, options, child });

    queueMicrotask(() => {
      child.emit('spawn');

      if (args.includes('build:dev')) {
        child.emit('close', compileExit, null);
      }
    });

    return child;
  }

  return {
    calls,
    exits,
    options: {
      spawn,
      backendDir: '/isolated/backend',
      nodeExecutable: '/fake/node',
      npmExecutable: '/fake/npm',
      onUnexpectedExit(name, code, signal) {
        exits.push({ name, code, signal });
      }
    }
  };
}

async function adapter(options) {
  const { createBackendProcessAdapter } = await import(url);
  return createBackendProcessAdapter(options);
}

test('compiler runs once using backend development build', async () => {
  const h = harness();
  const a = await adapter(h.options);

  await a.compile();

  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].command, '/fake/npm');
  assert.deepEqual(
    h.calls[0].args,
    ['run', 'build:dev']
  );
  assert.equal(
    h.calls[0].options.cwd,
    '/isolated/backend'
  );
});

test('nonzero compiler exit prevents successful build', async () => {
  const h = harness({ compileExit: 2 });
  const a = await adapter(h.options);

  await assert.rejects(
    a.compile(),
    /2|compil|build/i
  );
});

test('API and worker launch as separate Node processes', async () => {
  const h = harness();
  const a = await adapter(h.options);

  const api = await a.startService('api');
  const worker = await a.startService('worker');

  assert.notEqual(api, worker);

  assert.equal(h.calls.length, 2);

  assert.equal(h.calls[0].command, '/fake/node');
  assert.equal(h.calls[1].command, '/fake/node');

  assert.deepEqual(
    h.calls[0].args,
    ['./scripts/node-start.js']
  );

  assert.deepEqual(
    h.calls[1].args,
    ['dist/worker-entry.js']
  );

  await a.stopService(api);
  await a.stopService(worker);
});

test('service shutdown sends SIGTERM and awaits exit', async () => {
  const h = harness();
  const a = await adapter(h.options);

  const api = await a.startService('api');

  await a.stopService(api);

  assert.equal(
    h.calls.filter(call => call.signal === 'SIGTERM').length,
    1
  );

  // Stopping an already-exited child should be safe.
  await a.stopService(api);

  assert.equal(
    h.calls.filter(call => call.signal === 'SIGTERM').length,
    1
  );

  assert.equal(h.exits.length, 0);
});

test('unexpected worker exit is reported', async () => {
  const h = harness();
  const a = await adapter(h.options);

  const worker = await a.startService('worker');

  worker.emit('close', 1, null);

  assert.deepEqual(h.exits, [
    { name: 'worker', code: 1, signal: null }
  ]);

  await a.stopService(worker);
});

test('ignored SIGTERM escalates to SIGKILL', async () => {
  const h = harness();
  const signals = [];

  h.options.stopTimeoutMs = 15;
  h.options.killTimeoutMs = 15;

  h.options.spawn = () => {
    const child = new EventEmitter();
    child.pid = 901;

    child.kill = signal => {
      signals.push(signal);

      if (signal === 'SIGKILL') {
        queueMicrotask(() => {
          child.emit('close', null, 'SIGKILL');
        });
      }

      return true;
    };

    queueMicrotask(() => child.emit('spawn'));
    return child;
  };

  const a = await adapter(h.options);
  const worker = await a.startService('worker');

  await a.stopService(worker);

  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(h.exits.length, 0);
});

test('rejected termination signal permits retry', async () => {
  const h = harness();
  const signals = [];

  h.options.spawn = () => {
    const child = new EventEmitter();
    child.pid = 902;

    child.kill = signal => {
      signals.push(signal);

      if (signals.length === 1) {
        return false;
      }

      queueMicrotask(() => {
        child.emit('close', null, signal);
      });

      return true;
    };

    queueMicrotask(() => child.emit('spawn'));
    return child;
  };

  const a = await adapter(h.options);
  const api = await a.startService('api');

  await assert.rejects(
    a.stopService(api),
    /Unable to signal/
  );

  await a.stopService(api);

  assert.deepEqual(signals, ['SIGTERM', 'SIGTERM']);
  assert.equal(h.exits.length, 0);
});

test('concurrent shutdown requests send one termination signal', async () => {
  const h = harness();
  const a = await adapter(h.options);

  const worker = await a.startService('worker');

  await Promise.all([
    a.stopService(worker),
    a.stopService(worker)
  ]);

  assert.equal(
    h.calls.filter(
      call => call.action === 'kill' &&
              call.signal === 'SIGTERM'
    ).length,
    1
  );

  assert.equal(h.exits.length, 0);
});
