import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import {
  createBackendProcessAdapter
} from '../../scripts/dev-backend-processes.mjs';

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function exists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function until(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;

  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error('PROCESS_TREE_OBSERVATION_TIMEOUT');
    }

    await sleep(20);
  }
}

function fixture(mode) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gh1131-b-compiler-tree-')
  );

  fs.writeFileSync(path.join(dir, 'mode'), mode);

  fs.writeFileSync(
    path.join(dir, 'child.cjs'),
    `
const fs = require('node:fs');

process.on('SIGTERM', () => {
  fs.writeFileSync('child.sigterm', 'received');
});

fs.writeFileSync('child.pid', String(process.pid));

setInterval(() => {}, 1000);
`
  );

  const executable = path.join(dir, 'fake-npm');

  fs.writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require('node:fs');
const { spawn } = require('node:child_process');

if (fs.readFileSync('mode', 'utf8') === 'stubborn') {
  process.on('SIGTERM', () => {
    fs.writeFileSync('parent.sigterm', 'received');
  });
}

fs.writeFileSync('parent.pid', String(process.pid));

spawn(process.execPath, ['child.cjs'], {
  cwd: process.cwd(),
  stdio: 'ignore'
});

setInterval(() => {}, 1000);
`,
    { mode: 0o755 }
  );

  const adapter = createBackendProcessAdapter({
    backendDir: dir,
    npmExecutable: executable,
    stopTimeoutMs: 150,
    killTimeoutMs: 500
  });

  function pid(filename) {
    return Number(
      fs.readFileSync(
        path.join(dir, filename),
        'utf8'
      )
    );
  }

  function cleanup() {
    const parentFile = path.join(dir, 'parent.pid');

    if (fs.existsSync(parentFile)) {
      const leader = pid('parent.pid');

      // Kill only the isolated process group created
      // by this test's compiler adapter.
      if (Number.isInteger(leader) && leader > 0) {
        try {
          process.kill(-leader, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') {
            throw error;
          }
        }
      }
    }

    fs.rmSync(dir, {
      recursive: true,
      force: true
    });
  }

  return {
    dir,
    adapter,
    pid,
    cleanup
  };
}

for (const mode of ['graceful-parent', 'stubborn']) {
  test(
    `compiler cancellation removes parent and child: ${mode}`,
    { timeout: 8000 },
    async () => {
      const f = fixture(mode);
      const controller = new AbortController();

      let compiling;
      let parentPid;
      let childPid;

      try {
        compiling = f.adapter.compile(controller.signal);

        await until(() =>
          fs.existsSync(path.join(f.dir, 'child.pid'))
        );

        parentPid = f.pid('parent.pid');
        childPid = f.pid('child.pid');

        assert.ok(exists(parentPid));
        assert.ok(exists(childPid));

        const rejected = assert.rejects(
          compiling,
          error => error?.name === 'AbortError'
        );

        controller.abort();

        await rejected;

        await until(
          () => !exists(parentPid) && !exists(childPid),
          3000
        );

        assert.equal(exists(parentPid), false);
        assert.equal(exists(childPid), false);

      } finally {
        controller.abort();

        try {
          f.cleanup();
        } finally {
          // Ensure cleanup exceptions do not conceal
          // a pending compilation rejection.
          if (compiling) {
            await compiling.catch(() => {});
          }
        }
      }
    }
  );
}

test('unconfirmed compiler termination fails explicitly', {
  timeout: 3000
}, async () => {
  const child = new EventEmitter();
  const signals = [];

  let spawnedResolve;

  const spawned = new Promise(resolve => {
    spawnedResolve = resolve;
  });

  child.pid = 999;

  child.kill = signal => {
    signals.push(signal);

    // Deliberately never emit close.
    return true;
  };

  const adapter = createBackendProcessAdapter({
    backendDir: '/isolated/backend',
    stopTimeoutMs: 20,
    killTimeoutMs: 30,

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

  const rejected = assert.rejects(
    compiling,
    /Compiler termination was not confirmed/
  );

  controller.abort();

  await rejected;

  assert.deepEqual(signals, [
    'SIGTERM',
    'SIGKILL'
  ]);
});
