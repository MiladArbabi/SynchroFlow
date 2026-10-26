import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.resolve('scripts/dev-backend-processes.mjs')
).href;

const { createBackendProcessAdapter } = await import(moduleUrl);

const delay = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function fixture(name, mode) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gh1131-b-real-process-')
  );

  const relative = name === 'api'
    ? 'scripts/node-start.js'
    : 'dist/worker-entry.js';

  const filename = path.join(dir, relative);

  fs.mkdirSync(path.dirname(filename), { recursive: true });

  const behavior = {
    graceful: `
      process.on('SIGTERM', () => process.exit(0));
    `,
    ignore: `
      process.on('SIGTERM', () => {});
    `,
    crash: `
      setTimeout(() => process.exit(17), 160);
    `
  }[mode];

  if (!behavior) {
    throw new Error(`Unknown fixture mode: ${mode}`);
  }

  fs.writeFileSync(filename, `
    const fs = require('node:fs');
    ${behavior}
    fs.writeFileSync('ready', 'yes');
    setInterval(() => {}, 1000);
  `);

  const unexpected = [];

  const adapter = createBackendProcessAdapter({
    backendDir: dir,
    nodeExecutable: process.execPath,
    stopTimeoutMs: 90,
    killTimeoutMs: 900,
    onUnexpectedExit(service, code, signal) {
      unexpected.push({ service, code, signal });
    }
  });

  return {
    dir,
    adapter,
    unexpected,

    async ready() {
      const deadline = Date.now() + 4000;

      while (!fs.existsSync(path.join(dir, 'ready'))) {
        if (Date.now() >= deadline) {
          throw new Error('Disposable process readiness timeout');
        }

        await delay(20);
      }
    },

    async cleanup(child) {
      if (
        child &&
        child.exitCode === null &&
        child.signalCode === null
      ) {
        child.kill('SIGKILL');
      }

      fs.rmSync(dir, {
        recursive: true,
        force: true
      });
    }
  };
}

test('real API child exits gracefully after SIGTERM', {
  timeout: 8000
}, async () => {
  const f = fixture('api', 'graceful');
  let child;

  try {
    child = await f.adapter.startService('api');
    await f.ready();

    await f.adapter.stopService(child);

    assert.equal(child.exitCode, 0);
    assert.deepEqual(f.unexpected, []);
  } finally {
    await f.cleanup(child);
  }
});

test('real worker ignoring SIGTERM receives SIGKILL', {
  timeout: 8000
}, async () => {
  const f = fixture('worker', 'ignore');
  let child;

  try {
    child = await f.adapter.startService('worker');
    await f.ready();

    await f.adapter.stopService(child);

    assert.equal(child.signalCode, 'SIGKILL');
    assert.deepEqual(f.unexpected, []);
  } finally {
    await f.cleanup(child);
  }
});

test('real unexpected worker crash is reported', {
  timeout: 8000
}, async () => {
  const f = fixture('worker', 'crash');
  let child;

  try {
    child = await f.adapter.startService('worker');

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker crash observation timeout'));
      }, 4000);

      child.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    assert.deepEqual(f.unexpected, [
      { service: 'worker', code: 17, signal: null }
    ]);
  } finally {
    await f.cleanup(child);
  }
});
