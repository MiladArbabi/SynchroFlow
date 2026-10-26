import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.resolve('scripts/dev-backend-supervisor.mjs')
).href;

async function createSupervisor(hooks) {
  const mod = await import(moduleUrl);
  assert.equal(typeof mod.createBackendSupervisor, 'function');
  return mod.createBackendSupervisor(hooks);
}

function fixture(failedBuilds = []) {
  const events = [];
  let buildCount = 0;

  const hooks = {
    compile: async () => {
      buildCount++;
      events.push('compile');

      if (failedBuilds.includes(buildCount)) {
        throw new Error('EXPECTED_COMPILE_FAILURE');
      }
    },
    startService: async name => {
      events.push(`start:${name}`);
      return { name };
    },
    stopService: async child => {
      events.push(`stop:${child.name}`);
    }
  };

  return {
    hooks,
    events,
    get buildCount() {
      return buildCount;
    }
  };
}

test('initial startup compiles once before both services', async () => {
  const f = fixture();
  const s = await createSupervisor(f.hooks);

  await s.start();

  assert.deepEqual(
    f.events,
    ['compile', 'start:api', 'start:worker']
  );

  await s.shutdown();
});

test('failed initial compilation starts neither service', async () => {
  const f = fixture([1]);
  const s = await createSupervisor(f.hooks);

  await assert.rejects(
    s.start(),
    /EXPECTED_COMPILE_FAILURE/
  );

  assert.deepEqual(f.events, ['compile']);
  await s.shutdown();
});

test('source rebuild stops services before compiling', async () => {
  const f = fixture();
  const s = await createSupervisor(f.hooks);

  await s.start();
  const start = f.events.length;

  await s.rebuild();

  const sequence = f.events.slice(start);
  const compileIndex = sequence.indexOf('compile');

  assert.ok(compileIndex >= 2);
  assert.ok(sequence.indexOf('stop:api') < compileIndex);
  assert.ok(sequence.indexOf('stop:worker') < compileIndex);

  assert.deepEqual(
    sequence.slice(compileIndex),
    ['compile', 'start:api', 'start:worker']
  );

  assert.equal(f.buildCount, 2);
  await s.shutdown();
});

test('failed rebuild prevents stale restart; later edit recovers', async () => {
  const f = fixture([2]);
  const s = await createSupervisor(f.hooks);

  await s.start();

  await assert.rejects(
    s.rebuild(),
    /EXPECTED_COMPILE_FAILURE/
  );

  assert.equal(
    f.events.filter(x => x === 'start:api').length,
    1
  );
  assert.equal(
    f.events.filter(x => x === 'start:worker').length,
    1
  );

  await s.rebuild();

  assert.equal(f.buildCount, 3);
  assert.equal(
    f.events.filter(x => x === 'start:api').length,
    2
  );
  assert.equal(
    f.events.filter(x => x === 'start:worker').length,
    2
  );

  await s.shutdown();
});

test('rapid changes never overlap TypeScript compilation', async () => {
  const f = fixture();
  let active = 0;
  let maximumActive = 0;
  let releaseBuild;
  let enteredBuild;

  const buildEntered = new Promise(resolve => {
    enteredBuild = resolve;
  });

  const blockedBuild = new Promise(resolve => {
    releaseBuild = resolve;
  });

  const originalCompile = f.hooks.compile;
  f.hooks.compile = async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);

    try {
      await originalCompile();

      if (f.buildCount === 2) {
        enteredBuild();
        await blockedBuild;
      }
    } finally {
      active--;
    }
  };

  const s = await createSupervisor(f.hooks);
  await s.start();

  const first = s.rebuild();
  await buildEntered;

  const second = s.rebuild();
  const third = s.rebuild();

  releaseBuild();

  await Promise.all([first, second, third]);

  assert.equal(maximumActive, 1);
  assert.ok(f.buildCount >= 3);

  await s.shutdown();
});

test('shutdown stops both services', async () => {
  const f = fixture();
  const s = await createSupervisor(f.hooks);

  await s.start();
  await s.shutdown();

  assert.ok(f.events.includes('stop:api'));
  assert.ok(f.events.includes('stop:worker'));

  assert.equal(
    f.events.filter(x => x.startsWith('start:')).length,
    2
  );
});

test('failed stop retains child for shutdown retry', async () => {
  const f = fixture();

  let workerStopAttempts = 0;

  const originalStop = f.hooks.stopService;

  f.hooks.stopService = async child => {
    if (child.name === 'worker') {
      workerStopAttempts++;

      if (workerStopAttempts === 1) {
        throw new Error('EXPECTED_WORKER_STOP_FAILURE');
      }
    }

    await originalStop(child);
  };

  const s = await createSupervisor(f.hooks);

  await s.start();

  await assert.rejects(
    s.rebuild(),
    /Unable to stop all backend services/
  );

  // Shutdown must still know about the worker
  // whose first stop attempt failed.
  await s.shutdown();

  assert.equal(workerStopAttempts, 2);

  assert.equal(
    f.events.filter(event => event === 'stop:worker').length,
    1
  );
});
