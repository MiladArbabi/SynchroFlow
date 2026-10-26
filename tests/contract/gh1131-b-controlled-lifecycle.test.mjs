import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

test('real watcher rebuild and SIGTERM lifecycle', {
  timeout: 15000
}, async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gh1131-b-lifecycle-')
  );

  const sourceDir = path.join(root, 'apps/backend/src');
  fs.mkdirSync(sourceDir, { recursive: true });

  const entryUrl = pathToFileURL(
    path.resolve('scripts/dev-backend-entry.mjs')
  ).href;

  const childSource = `
import fs from 'node:fs';
import path from 'node:path';
import { createBackendDevEntrypoint } from ${JSON.stringify(entryUrl)};

const root = ${JSON.stringify(root)};
const source = path.join(root, 'apps/backend/src/smoke.ts');
const emit = value => process.send?.(value);

process.on('message', message => {
  if (message === 'edit') {
    fs.writeFileSync(source, 'export const smoke = 1;\\n');
    emit('edit:written');
  }
});

const app = createBackendDevEntrypoint({
  repoRoot: root,

  async waitForDatabase(signal) {
    if (signal.aborted) throw new Error('Already cancelled');
    emit('database:ready');
  },

  makeProcessAdapter() {
    return {
      async compile(signal) {
        if (signal.aborted) throw new Error('Cancelled');
        emit('compile');
      },

      async startService(name) {
        emit('start:' + name);
        return { name };
      },

      async stopService(child) {
        emit('stop:' + child.name);
      }
    };
  },

  reportError(error) {
    emit('error:' + error.message);
  },

  onExit(code) {
    process.exitCode = code;
    process.send?.('exit:' + code, () => {
      process.disconnect?.();
    });
  }
});

await app.start();
`;

  const events = [];
  let stderr = '';
  let workerStarts = 0;
  let watchdog;

  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', childSource],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    }
  );

  try {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', text => {
      stderr += text;
    });

    child.stdout.resume();

    child.on('message', value => {
      events.push(value);

      if (value !== 'start:worker') return;

      workerStarts++;

      if (workerStarts === 1) {
        setTimeout(() => {
          if (child.connected) child.send('edit');
        }, 650);
      }

      if (workerStarts === 2) {
        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGTERM');
          }
        }, 250);
      }
    });

    const result = await new Promise((resolve, reject) => {
      watchdog = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('LIFECYCLE_TIMEOUT'));
      }, 12000);

      child.once('error', reject);
      child.once('exit', (code, signal) => {
        resolve({ code, signal });
      });
    });

    assert.equal(
      result.code,
      0,
      JSON.stringify(result) + '\n' + stderr
    );

    assert.deepEqual(
      events,
      [
        'database:ready',
        'compile',
        'start:api',
        'start:worker',
        'edit:written',
        'stop:api',
        'stop:worker',
        'compile',
        'start:api',
        'start:worker',
        'stop:api',
        'stop:worker',
        'exit:0'
      ]
    );

  } finally {
    clearTimeout(watchdog);

    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }

    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
