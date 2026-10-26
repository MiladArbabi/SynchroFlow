import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(
  path.resolve('scripts/dev-backend-watcher.mjs')
).href;

const delay = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

async function fixture(overrides = {}) {
  const { watchBackendSources } = await import(moduleUrl);

  const watcher = new EventEmitter();
  const calls = [];
  const errors = [];
  let callback;
  let closed = false;

  watcher.close = () => {
    closed = true;
  };

  const session = watchBackendSources({
    sourceDir: '/isolated/backend/src',
    debounceMs: 15,

    watch(directory, options, listener) {
      calls.push({ directory, options });
      callback = listener;
      return watcher;
    },

    onChange: overrides.onChange ?? (() => {
      calls.push({ action: 'rebuild' });
    }),

    reportError(error) {
      errors.push(error.message);
    }
  });

  return {
    session,
    watcher,
    calls,
    errors,
    emit(event, filename) {
      callback(event, filename);
    },
    get closed() {
      return closed;
    }
  };
}

test('watches nested backend source and triggers rebuild', async () => {
  const f = await fixture();

  assert.equal(
    f.calls[0].directory,
    '/isolated/backend/src'
  );

  assert.equal(
    f.calls[0].options.recursive,
    true
  );

  f.emit('change', 'warehouse/receive.ts');

  await delay(60);

  assert.equal(
    f.calls.filter(x => x.action === 'rebuild').length,
    1
  );

  f.session.close();
});

test('rapid changes combine into one rebuild notification', async () => {
  const f = await fixture();

  f.emit('change', 'a.ts');
  f.emit('change', 'b.ts');
  f.emit('rename', 'nested/c.ts');

  await delay(60);

  assert.equal(
    f.calls.filter(x => x.action === 'rebuild').length,
    1
  );

  f.session.close();
});

test('ignores unrelated files and stops notifications after close', async () => {
  const f = await fixture();

  f.emit('change', 'README.md');

  await delay(40);

  assert.equal(
    f.calls.filter(x => x.action === 'rebuild').length,
    0
  );

  f.session.close();

  assert.equal(f.closed, true);

  f.emit('change', 'changed.ts');

  await delay(40);

  assert.equal(
    f.calls.filter(x => x.action === 'rebuild').length,
    0
  );
});

test('reports asynchronous rebuild errors', async () => {
  const f = await fixture({
    async onChange() {
      throw new Error('EXPECTED_REBUILD_FAILURE');
    }
  });

  f.emit('change', 'api.ts');

  await delay(60);

  assert.deepEqual(
    f.errors,
    ['EXPECTED_REBUILD_FAILURE']
  );

  f.session.close();
});

test('reports filesystem watcher errors', async () => {
  const f = await fixture();

  f.watcher.emit(
    'error',
    new Error('EXPECTED_WATCH_FAILURE')
  );

  assert.deepEqual(
    f.errors,
    ['EXPECTED_WATCH_FAILURE']
  );

  f.session.close();
});

test('real filesystem detects nested TypeScript changes', {
  timeout: 8000
}, async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');

  const { watchBackendSources } = await import(moduleUrl);

  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'gh1131-b-watch-')
  );

  const src = path.join(root, 'src');
  const nested = path.join(src, 'warehouse');
  const file = path.join(nested, 'receive.ts');

  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(file, 'export const n = 1;\n');

  let watcher;
  let timeoutId;
  let notifications = 0;

  try {
    let complete;
    let fail;

    const received = new Promise((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });

    watcher = watchBackendSources({
      sourceDir: src,
      debounceMs: 30,

      onChange() {
        notifications++;
        complete();
      },

      reportError(error) {
        fail(error);
      }
    });

    const deadline = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(
          new Error('Real nested filesystem event not received')
        ),
        4000
      );
    });

    // macOS recursive watcher registration can be asynchronous.
    // Allow registration to settle before the single test edit.
    await delay(500);

    fs.appendFileSync(file, 'export const m = 2;\n');

    await Promise.race([received, deadline]);

    assert.ok(notifications >= 1);

  } finally {
    clearTimeout(timeoutId);
    watcher?.close();

    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
