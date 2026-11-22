/**
 * ENV-DB-PARITY-01 — Development migration parity regressions.
 *
 * DB-free: the PostgreSQL client is injected. Run directly with
 * `node --test tests/contract/env-db-parity-01.test.mjs`, or through
 * tests/contract/env-db-parity-01.contract.test.ts (test:contract).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const parityUrl = pathToFileURL(
  path.resolve('scripts/dev-migration-parity.mjs')
).href;

const entryUrl = pathToFileURL(
  path.resolve('scripts/dev-backend-entry.mjs')
).href;

const {
  compareMigrationParity,
  listSourceMigrations,
  readMigrationLedger,
  resolveDevDatabaseConfig,
  assertDevMigrationParity,
  MIGRATE_COMMAND,
} = await import(parityUrl);

const A = '20260101000000_0001_a.js';
const B = '20260102000000_0002_b.js';
const C = '20260103000000_0003_c.js';
const D = '20260104000000_0004_d.js';
const FOREIGN = '20260102120000_9999_other_branch.js';

const CONFIG = {
  host: 'localhost',
  port: 5432,
  user: 'sf_app',
  password: 'S3CRET-NEVER-PRINT',
  database: 'synchroflow_db',
};

const MUTATING_SQL =
  /\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|LOCK|COPY)\b/i;

function fakeClient({
  ledger = [A, B, C],
  tablePresent = true,
  connectError,
  queryError,
} = {}) {
  const state = { config: null, queries: [], ended: false };

  const createClient = config => {
    state.config = config;
    return {
      async connect() {
        if (connectError) throw connectError;
      },
      async query(sql, params) {
        state.queries.push(sql);
        if (queryError && /to_regclass/.test(sql)) throw queryError;
        if (/to_regclass/.test(sql)) {
          assert.deepEqual(params, ['public.knex_migrations']);
          return { rows: [{ present: tablePresent }] };
        }
        if (/FROM public\.knex_migrations/.test(sql)) {
          return { rows: ledger.map(name => ({ name })) };
        }
        return { rows: [] };
      },
      async end() {
        state.ended = true;
      },
    };
  };

  return { state, createClient };
}

// ---------------------------------------------------------------- compare

test('up-to-date database passes', () => {
  const result = compareMigrationParity({
    source: [C, A, B],
    ledger: [A, B, C],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.unexpected, []);
  assert.equal(result.isDivergent, false);
  assert.equal(result.newestApplied, C);
});

test('pending source migration is MISSING, not divergent', () => {
  const result = compareMigrationParity({
    source: [A, B, C, D],
    ledger: [A, B, C],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [D]);
  assert.deepEqual(result.unexpected, []);
  assert.equal(result.isDivergent, false);
});

test('empty ledger reports every source migration missing', () => {
  const result = compareMigrationParity({ source: [A, B], ledger: [] });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, [A, B]);
  assert.equal(result.isDivergent, false);
});

test('applied migration absent from source is UNEXPECTED', () => {
  const result = compareMigrationParity({
    source: [A, B, C],
    ledger: [A, B, FOREIGN, C],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpected, [FOREIGN]);
  assert.deepEqual(result.missing, []);
});

test('unapplied migration older than an applied one is a divergent gap', () => {
  const result = compareMigrationParity({
    source: [A, B, C],
    ledger: [A, C],
  });

  assert.equal(result.ok, false);
  assert.equal(result.isDivergent, true);
  assert.deepEqual(result.divergent.gaps, [B]);
  assert.deepEqual(result.missing, []);
});

test('ledger order differing from source order is divergent', () => {
  const result = compareMigrationParity({
    source: [A, B, C],
    ledger: [A, C, B],
  });

  assert.equal(result.ok, false);
  assert.equal(result.isDivergent, true);
  assert.deepEqual(result.divergent.outOfOrder, [C, B]);
});

test('duplicate ledger rows are divergent', () => {
  const result = compareMigrationParity({
    source: [A, B],
    ledger: [A, B, B],
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.divergent.duplicates, [B]);
});

// ----------------------------------------------------------------- source

test('source listing maps TypeScript migrations to ledger names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-db-parity-'));
  try {
    for (const file of [
      '20260102000000_0002_b.ts',
      '20260101000000_0001_a.ts',
      'helper.d.ts',
      'README.md',
    ]) {
      fs.writeFileSync(path.join(dir, file), '');
    }

    assert.deepEqual(listSourceMigrations(dir), [A, B]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the real checkout lists every apps/backend migration', () => {
  const dir = path.resolve('apps/backend/migrations');
  const tsCount = fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts')).length;
  const listed = listSourceMigrations(dir);

  assert.equal(listed.length, tsCount);
  assert.ok(listed.every(name => name.endsWith('.js')));
});

// ------------------------------------------------------------- read-only

test('ledger read is read-only and closes the connection', async () => {
  const fake = fakeClient();

  const ledger = await readMigrationLedger(CONFIG, fake);

  assert.deepEqual(ledger, [A, B, C]);
  assert.equal(
    fake.state.config.options,
    '-c default_transaction_read_only=on'
  );
  assert.equal(fake.state.config.user, 'sf_app');
  assert.equal(fake.state.queries[0], 'BEGIN READ ONLY');
  assert.equal(fake.state.queries.at(-1), 'ROLLBACK');
  assert.ok(
    fake.state.queries.every(sql => !MUTATING_SQL.test(sql)),
    `mutating SQL issued: ${fake.state.queries.join(' | ')}`
  );
  assert.equal(fake.state.ended, true);
});

test('missing ledger table reads as an empty history', async () => {
  const fake = fakeClient({ tablePresent: false });

  assert.deepEqual(await readMigrationLedger(CONFIG, fake), []);
  assert.ok(
    !fake.state.queries.some(sql => /FROM public\.knex_migrations/.test(sql))
  );
  assert.equal(fake.state.queries.at(-1), 'ROLLBACK');
});

test('unreachable database yields a clear, secret-free error', async () => {
  const refused = Object.assign(new Error('connect ECONNREFUSED'), {
    code: 'ECONNREFUSED',
  });
  const fake = fakeClient({ connectError: refused });

  await assert.rejects(readMigrationLedger(CONFIG, fake), error => {
    assert.equal(error.code, 'DEV_DATABASE_UNAVAILABLE');
    assert.match(error.message, /cannot connect to database "synchroflow_db"/);
    assert.match(error.message, /ECONNREFUSED/);
    assert.match(error.message, /stopped before compiling/);
    assert.ok(!error.message.includes(CONFIG.password));
    return true;
  });
  assert.deepEqual(fake.state.queries, []);
  assert.equal(fake.state.ended, true);
});

test('ledger query failure is reported and rolled back', async () => {
  const denied = Object.assign(new Error('permission denied'), {
    code: '42501',
  });
  const fake = fakeClient({ queryError: denied });

  await assert.rejects(readMigrationLedger(CONFIG, fake), error => {
    assert.equal(error.code, 'DEV_DATABASE_UNAVAILABLE');
    assert.match(error.message, /could not read the migration ledger/);
    return true;
  });
  assert.equal(fake.state.queries.at(-1), 'ROLLBACK');
  assert.equal(fake.state.ended, true);
});

// ------------------------------------------------------------ end-to-end

function withRepo(envFile, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-db-parity-repo-'));
  try {
    if (envFile !== undefined) {
      fs.writeFileSync(path.join(root, '.env'), envFile);
    }
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('config falls back to ./.env; process values take precedence', () => {
  withRepo(
    'PGHOST=filehost\nPGPORT=6543\nPGUSER=sf_app\nPGPASSWORD=x\nPGDATABASE=filedb\n',
    root => {
      const config = resolveDevDatabaseConfig({
        repoRoot: root,
        env: { PGDATABASE: 'envdb' },
      });

      assert.equal(config.host, 'filehost');
      assert.equal(config.port, 6543);
      assert.equal(config.database, 'envdb');
    }
  );
});

test('absent database configuration blocks with a clear error', () => {
  withRepo(undefined, root => {
    assert.throws(
      () => resolveDevDatabaseConfig({ repoRoot: root, env: {} }),
      error => {
        assert.equal(error.code, 'DEV_DATABASE_CONFIG_MISSING');
        assert.match(error.message, /PGHOST/);
        return true;
      }
    );
  });
});

const ENV = {
  PGHOST: 'localhost',
  PGPORT: '5432',
  PGUSER: 'sf_app',
  PGPASSWORD: CONFIG.password,
  PGDATABASE: 'synchroflow_db',
};

test('assert passes when source and ledger match', async () => {
  const logs = [];
  const result = await assertDevMigrationParity({
    repoRoot: '/isolated',
    env: ENV,
    listSource: () => [A, B, C],
    readLedger: async () => [A, B, C],
    log: line => logs.push(line),
  });

  assert.equal(result.ok, true);
  assert.match(logs[0], /PASS: 3\/3/);
});

test('missing migration blocks with the migrate instruction', async () => {
  await assert.rejects(
    assertDevMigrationParity({
      repoRoot: '/isolated',
      env: ENV,
      listSource: () => [A, B, C, D],
      readLedger: async () => [A, B, C],
    }),
    error => {
      assert.equal(error.code, 'DEV_MIGRATION_PARITY_FAILED');
      assert.match(error.message, /MISSING — 1 migration/);
      assert.ok(error.message.includes(D));
      assert.ok(error.message.includes(MIGRATE_COMMAND));
      assert.match(error.message, /nothing was migrated, reset or modified/);
      assert.ok(!error.message.includes(CONFIG.password));
      return true;
    }
  );
});

test('divergent history blocks without suggesting forward migration', async () => {
  await assert.rejects(
    assertDevMigrationParity({
      repoRoot: '/isolated',
      env: ENV,
      listSource: () => [A, B, C],
      readLedger: async () => [A, FOREIGN, C],
    }),
    error => {
      assert.equal(error.code, 'DEV_MIGRATION_PARITY_FAILED');
      assert.match(error.message, /UNEXPECTED — 1 applied/);
      assert.match(error.message, /DIVERGENT/);
      assert.ok(error.message.includes(FOREIGN));
      assert.ok(!error.message.includes(MIGRATE_COMMAND));
      return true;
    }
  );
});

// --------------------------------------------------------- startup gate

async function startEntry(waitForDatabase) {
  const { createBackendDevEntrypoint } = await import(entryUrl);
  const events = [];

  const app = createBackendDevEntrypoint({
    repoRoot: '/isolated/repository',
    signals: new EventEmitter(),
    waitForDatabase,
    makeProcessAdapter: () => ({
      async compile() {
        events.push('compile');
      },
      async startService(name) {
        events.push(`start:${name}`);
        return { name };
      },
      async stopService(child) {
        events.push(`stop:${child.name}`);
      },
    }),
    makeWatcher: () => {
      events.push('watch:open');
      return { close: () => events.push('watch:close') };
    },
    reportError: error => events.push(`error:${error.code ?? error.message}`),
    onExit: code => events.push(`exit:${code}`),
  });

  await app.start();
  return { app, events };
}

test('parity failure stops dev startup before compile or services', async () => {
  const { events } = await startEntry(() =>
    assertDevMigrationParity({
      repoRoot: '/isolated/repository',
      env: ENV,
      listSource: () => [A, B, C, D],
      readLedger: async () => [A, B, C],
    })
  );

  assert.deepEqual(events, [
    'error:DEV_MIGRATION_PARITY_FAILED',
    'exit:1',
  ]);
});

test('database unavailability stops dev startup with exit 1', async () => {
  const fake = fakeClient({
    connectError: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
  });

  const { events } = await startEntry(() =>
    assertDevMigrationParity({
      repoRoot: '/isolated/repository',
      env: ENV,
      listSource: () => [A],
      readLedger: config => readMigrationLedger(config, fake),
    })
  );

  assert.deepEqual(events, ['error:DEV_DATABASE_UNAVAILABLE', 'exit:1']);
});

test('parity pass preserves the existing startup sequence', async () => {
  const { app, events } = await startEntry(() =>
    assertDevMigrationParity({
      repoRoot: '/isolated/repository',
      env: ENV,
      listSource: () => [A, B],
      readLedger: async () => [A, B],
      log: () => {},
    })
  );

  assert.deepEqual(events, [
    'watch:open',
    'compile',
    'start:api',
    'start:worker',
  ]);

  await app.shutdown();
  assert.equal(events.at(-1), 'exit:0');
});

test('default dev readiness runs parity after TCP readiness', () => {
  const source = fs.readFileSync('scripts/dev-backend-entry.mjs', 'utf8');
  const defaults = source.slice(
    source.indexOf('waitForDatabase = async signal =>'),
    source.indexOf('makeProcessAdapter = createBackendProcessAdapter')
  );

  const tcp = defaults.indexOf('await waitForDatabasePort({ signal })');
  const parity = defaults.indexOf('await assertDevMigrationParity({ repoRoot })');

  assert.ok(tcp >= 0, 'TCP readiness missing from default');
  assert.ok(parity > tcp, 'parity must follow TCP readiness');
});

test('root npm run dev runs parity before dev:prepare and concurrent services', () => {
  const scripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;

  assert.equal(scripts['dev:parity'], 'node scripts/dev-migration-parity.mjs');

  const steps = scripts.dev.split(' && ');
  assert.equal(steps[0], 'npm run dev:parity');
  assert.equal(steps[1], 'npm run dev:prepare');
  assert.match(steps.at(-1), /^concurrently /);
});

test('production and CI entry points do not load the parity check', () => {
  const rootScripts = JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts;
  const backendScripts = JSON.parse(
    fs.readFileSync('apps/backend/package.json', 'utf8')
  ).scripts;

  assert.equal(rootScripts.start, 'node apps/backend/dist/server.js');
  assert.equal(backendScripts.start, 'node ./scripts/node-start.js');

  for (const file of [
    'apps/backend/scripts/node-start.js',
    'apps/backend/src/server.ts',
    'apps/backend/src/worker-entry.ts',
  ]) {
    if (fs.existsSync(file)) {
      assert.ok(
        !fs.readFileSync(file, 'utf8').includes('dev-migration-parity'),
        `${file} must not load the dev parity check`
      );
    }
  }
});
