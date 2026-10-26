import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const supervisorUrl = pathToFileURL(
  path.resolve('scripts/dev-backend-supervisor.mjs')
).href;

const processesUrl = pathToFileURL(
  path.resolve('scripts/dev-backend-processes.mjs')
).href;

function withDeadline(promise, ms = 300) {
  let timer;

  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('COMPILE_CANCELLATION_TIMEOUT')),
      ms
    );
  });

  return Promise.race([promise, deadline])
    .finally(() => clearTimeout(timer));
}

test('supervisor shutdown aborts active compilation', {
  timeout: 1500
}, async () => {
  const { createBackendSupervisor } =
    await import(supervisorUrl);

  let enteredResolve;
  const entered = new Promise(resolve => {
    enteredResolve = resolve;
  });

  let receivedSignal;
  let serviceStarts = 0;

  const supervisor = createBackendSupervisor({
    compile(signal) {
      receivedSignal = signal;
      enteredResolve();

      return new Promise(resolve => {
        if (signal?.aborted) {
          resolve();
        } else {
          signal?.addEventListener(
            'abort',
            resolve,
            { once: true }
          );
        }
      });
    },

    async startService() {
      serviceStarts++;
      return {};
    },

    async stopService() {}
  });

  const starting = supervisor.start();

  await entered;

  const stopping = supervisor.shutdown();

  await withDeadline(
    Promise.all([starting, stopping])
  );

  assert.equal(receivedSignal?.aborted, true);
  assert.equal(serviceStarts, 0);
});

test('process adapter terminates compiler when aborted', {
  timeout: 1500
}, async () => {
  const { createBackendProcessAdapter } =
    await import(processesUrl);

  const child = new EventEmitter();
  const signals = [];

  let spawnedResolve;
  const spawned = new Promise(resolve => {
    spawnedResolve = resolve;
  });

  child.pid = 999;

  child.kill = signal => {
    signals.push(signal);

    queueMicrotask(() => {
      child.emit('close', null, signal);
    });

    return true;
  };

  const adapter = createBackendProcessAdapter({
    backendDir: '/isolated/backend',

    spawn() {
      queueMicrotask(() => {
        child.emit('spawn');
        spawnedResolve();
      });

      return child;
    }
  });

  const controller = new AbortController();

  const compiling = adapter.compile(controller.signal);

  await spawned;

  const assertion = assert.rejects(
    withDeadline(compiling),
    error => error?.name === 'AbortError'
  );

  controller.abort();

  await assertion;

  assert.deepEqual(signals, ['SIGTERM']);
});
