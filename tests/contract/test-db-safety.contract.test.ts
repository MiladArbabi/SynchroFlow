// tests/contract/test-db-safety.contract.test.ts
//
// TEST-INFRA-FOUNDATION Slice 2A — contract for the pure test-db safety
// decision boundary (scripts/test-db-safety.js).
//
// This suite never connects to PostgreSQL, never shells out, never touches
// the filesystem. GH-1068 T3: the harness lifecycle ordering is proven through
// scripts/with-test-db.js runLifecycle() with injected in-memory fakes only.

import {
  assertSafeTestDatabase,
  assertNoInheritedDatabaseUrls,
  createTestDatabaseName,
  ERROR_CODES,
  HARNESS_DATABASE_URL_KEYS,
  TEST_DB_NAME_PATTERN,
} from '../../scripts/test-db-safety';

const { runLifecycle } = require('../../scripts/with-test-db');

function validInput() {
  return {
    nodeEnv: 'test',
    testDatabase: 'synchroflow_test_abc123',
    developmentDatabase: 'synchroflow_db',
    runtimeUser: 'sf_app',
    migrationUser: 'sf_user',
  };
}

function expectCode(fn: () => void, code: string) {
  expect(fn).toThrow();
  try {
    fn();
    // Unreachable — the expect(fn).toThrow() above already guarantees a throw.
  } catch (err: any) {
    expect(err.code).toBe(code);
  }
}

describe('test-db-safety contract', () => {
  it('exposes exactly the seven required stable error identifiers', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual(
      [
        'UNSAFE_NODE_ENV',
        'UNSAFE_TEST_DB_NAME',
        'TEST_DB_EQUALS_DEV_DB',
        'MISSING_DEV_DB',
        'MISSING_RUNTIME_USER',
        'MISSING_MIGRATION_USER',
        'ROLE_SEPARATION_REQUIRED',
      ].sort()
    );
    // Values equal their own keys — the identifier IS the string.
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });

  it('PASS: accepts a fully valid configuration', () => {
    expect(() => assertSafeTestDatabase(validInput())).not.toThrow();
  });

  it('REJECT A: NODE_ENV=development', () => {
    expectCode(
      () => assertSafeTestDatabase({ ...validInput(), nodeEnv: 'development' }),
      ERROR_CODES.UNSAFE_NODE_ENV
    );
  });

  it('REJECT B: NODE_ENV=production', () => {
    expectCode(
      () => assertSafeTestDatabase({ ...validInput(), nodeEnv: 'production' }),
      ERROR_CODES.UNSAFE_NODE_ENV
    );
  });

  it('REJECT C: testDatabase=synchroflow_db (the real dev/prod name)', () => {
    expectCode(
      () => assertSafeTestDatabase({ ...validInput(), testDatabase: 'synchroflow_db' }),
      ERROR_CODES.UNSAFE_TEST_DB_NAME
    );
  });

  it('REJECT D: testDatabase=random_database (wrong prefix entirely)', () => {
    expectCode(
      () => assertSafeTestDatabase({ ...validInput(), testDatabase: 'random_database' }),
      ERROR_CODES.UNSAFE_TEST_DB_NAME
    );
  });

  it('REJECT E: testDatabase=synchroflow_test_ (empty suffix)', () => {
    expectCode(
      () => assertSafeTestDatabase({ ...validInput(), testDatabase: 'synchroflow_test_' }),
      ERROR_CODES.UNSAFE_TEST_DB_NAME
    );
  });

  it('REJECT F: testDatabase equals developmentDatabase even though both match the approved prefix', () => {
    const sharedName = 'synchroflow_test_shared_name';
    expectCode(
      () =>
        assertSafeTestDatabase({
          ...validInput(),
          testDatabase: sharedName,
          developmentDatabase: sharedName,
        }),
      ERROR_CODES.TEST_DB_EQUALS_DEV_DB
    );
  });

  it('REJECT G: missing development database', () => {
    expectCode(
      () => assertSafeTestDatabase({ ...validInput(), developmentDatabase: '' }),
      ERROR_CODES.MISSING_DEV_DB
    );
  });

  it('REJECT H: missing runtime user', () => {
    expectCode(
      () => assertSafeTestDatabase({ ...validInput(), runtimeUser: '' }),
      ERROR_CODES.MISSING_RUNTIME_USER
    );
  });

  it('REJECT I: missing migration user', () => {
    expectCode(
      () => assertSafeTestDatabase({ ...validInput(), migrationUser: '' }),
      ERROR_CODES.MISSING_MIGRATION_USER
    );
  });

  it('REJECT J: runtimeUser === migrationUser', () => {
    expectCode(
      () =>
        assertSafeTestDatabase({
          ...validInput(),
          runtimeUser: 'sf_shared',
          migrationUser: 'sf_shared',
        }),
      ERROR_CODES.ROLE_SEPARATION_REQUIRED
    );
  });

  describe('createTestDatabaseName()', () => {
    it('matches the approved regex and begins with the required prefix', () => {
      const name = createTestDatabaseName();
      expect(name).toMatch(TEST_DB_NAME_PATTERN);
      expect(name.startsWith('synchroflow_test_')).toBe(true);
    });

    it('produces distinct values across a bounded sample (collision resistance)', () => {
      const sample = new Set<string>();
      for (let i = 0; i < 50; i++) {
        sample.add(createTestDatabaseName());
      }
      expect(sample.size).toBe(50);
    });

    it('never equals the development database name', () => {
      for (let i = 0; i < 20; i++) {
        expect(createTestDatabaseName()).not.toBe('synchroflow_db');
      }
    });

    it('every generated name passes assertSafeTestDatabase against a valid config', () => {
      const name = createTestDatabaseName();
      expect(() =>
        assertSafeTestDatabase({ ...validInput(), testDatabase: name })
      ).not.toThrow();
    });
  });
});

describe('GH-1068 T3 disposable harness — inherited configuration and lifecycle ordering', () => {
  const GENERATED = 'synchroflow_test_contract_generated';
  const SECRET = 'SENTINEL-contract-secret-never-printed';

  function harnessEnv(): Record<string, string | undefined> {
    return {
      PATH: '/usr/bin', PGHOST: 'isolated-postgres', PGPORT: '5432', PGDATABASE: 'synchroflow_db',
      PGUSER: 'sf_app', PGPASSWORD: SECRET, PGMIGRATION_USER: 'isolated_admin',
      PGMIGRATION_PASSWORD: SECRET, SYNCHROFLOW_TEST_EXECUTOR_PASSWORD: `${SECRET}-0123456789abcdef`,
    };
  }

  /** Same-cluster URL that WOULD satisfy assertTestConnections for PGDATABASE. */
  function plausibleUrl(key: string) {
    const user = key === 'MIGRATION_DATABASE_URL' ? 'isolated_admin'
      : key === 'SHOPIFY_RECONNECT_DATABASE_URL' ? 'sf_shopify_reconnect_executor' : 'sf_app';
    const password = key === 'SHOPIFY_RECONNECT_DATABASE_URL' ? `${SECRET}-0123456789abcdef` : SECRET;
    return `postgresql://${user}:${encodeURIComponent(password)}@isolated-postgres:5432/synchroflow_db?sslmode=disable`;
  }

  function fakes(options: { baselineExists?: boolean; provisionFails?: boolean; orphan?: boolean } = {}) {
    const queries: string[] = [];
    const output: string[] = [];
    const clients: { config: any; ended: boolean }[] = [];
    const state = { databases: new Set(['postgres', ...(options.baselineExists === false ? [] : ['synchroflow_db'])]) };
    class FakeClient {
      record: { config: any; ended: boolean };
      constructor(config: any) { this.record = { config, ended: false }; clients.push(this.record); }
      async connect() {}
      async end() { this.record.ended = true; }
      async query(sql: string, params: unknown[] = []) {
        queries.push(sql.replace(/\s+/g, ' ').trim());
        if (sql === 'SELECT current_user') return { rows: [{ current_user: 'isolated_admin' }] };
        if (sql.includes('pg_control_system')) return { rows: [{ id: '42' }] };
        const create = /^CREATE DATABASE "(.+)"$/.exec(sql);
        if (create) { state.databases.add(create[1]); return { rows: [] }; }
        const drop = /^DROP DATABASE IF EXISTS "(.+)"$/.exec(sql);
        if (drop) { state.databases.delete(drop[1]); return { rows: [] }; }
        if (sql.includes("LIKE 'synchroflow_test")) {
          return { rows: [...state.databases].filter(d => d.startsWith('synchroflow_test_'))
            .concat(options.orphan ? ['synchroflow_test_orphan'] : []).map(datname => ({ datname })) };
        }
        if (/pg_database WHERE datname ?= ?\$1/.test(sql)) {
          return { rows: state.databases.has(String(params[0])) ? [{ '?column?': 1 }] : [] };
        }
        if (sql.startsWith('GRANT CONNECT') || sql.includes('pg_terminate_backend')) return { rows: [] };
        throw new Error('UNEXPECTED_FAKE_QUERY');
      }
    }
    const verifyTopology = jest.fn(async () => ({}));
    const verifyContext = jest.fn(async (target: any) => ({ ...target, administrator: 'isolated_admin',
      isolated: true, disposable: true }));
    const provision = jest.fn(async () => {
      if (options.provisionFails) throw new Error(`PROVISION_FAILED ${SECRET}`);
      return { created: [] };
    });
    const spawn = jest.fn(() => { throw new Error('SPAWN_NOT_EXPECTED'); });
    const deps = { Client: FakeClient, verifyTopology, verifyContext, provision, spawn,
      generateName: () => GENERATED, log: (line: string) => output.push(line),
      error: (line: string) => output.push(line) };
    return { deps, queries, output, clients, state, verifyTopology, verifyContext, provision, spawn };
  }

  it('assertNoInheritedDatabaseUrls rejects every inherited harness URL, including empty values', () => {
    expect([...HARNESS_DATABASE_URL_KEYS].sort()).toEqual(['APP_DATABASE_URL', 'DATABASE_URL',
      'MIGRATION_DATABASE_URL', 'SHOPIFY_RECONNECT_DATABASE_URL']);
    expect(() => assertNoInheritedDatabaseUrls(harnessEnv())).not.toThrow();
    for (const key of HARNESS_DATABASE_URL_KEYS) {
      for (const value of [plausibleUrl(key), '']) {
        expect(() => assertNoInheritedDatabaseUrls({ ...harnessEnv(), [key]: value }))
          .toThrow(/^UNSAFE_TEST_CONNECTION_CONFIGURATION$/);
      }
    }
  });

  it.each(['DATABASE_URL', 'APP_DATABASE_URL', 'MIGRATION_DATABASE_URL', 'SHOPIFY_RECONNECT_DATABASE_URL'])(
    'refuses an inherited %s before topology verification, any connection or creation', async key => {
      const f = fakes();
      await expect(runLifecycle({ env: { ...harnessEnv(), [key]: plausibleUrl(key) },
        argv: ['--provision-only'], deps: f.deps })).rejects.toThrow(/^UNSAFE_TEST_CONNECTION_CONFIGURATION$/);
      expect(f.verifyTopology).not.toHaveBeenCalled();
      expect(f.clients).toHaveLength(0);
      expect(f.queries).toEqual([]);
      expect(f.provision).not.toHaveBeenCalled();
    });

  it('refuses a missing baseline database before CREATE DATABASE and creates nothing', async () => {
    const f = fakes({ baselineExists: false });
    const code = await runLifecycle({ env: harnessEnv(), argv: ['--provision-only'], deps: f.deps });
    expect(code).toBe(1);
    expect(f.queries.some(q => q.startsWith('CREATE DATABASE'))).toBe(false);
    expect(f.queries.some(q => q.startsWith('DROP DATABASE'))).toBe(false);
    expect(f.provision).not.toHaveBeenCalled();
    expect(f.clients.every(c => c.ended)).toBe(true);
    expect(f.output).toEqual(['LIFECYCLE_ERROR=DISPOSABLE_TEST_LIFECYCLE_FAILED']);
  });

  it('a failure after creation still drops exactly the generated database and proves cleanup', async () => {
    const f = fakes({ provisionFails: true });
    const code = await runLifecycle({ env: harnessEnv(), argv: ['--provision-only'], deps: f.deps });
    expect(code).toBe(1);
    const order = ['CREATE DATABASE', 'pg_terminate_backend', 'DROP DATABASE'].map(fragment =>
      f.queries.findIndex(q => q.includes(fragment)));
    expect(order.every(index => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(f.queries).toContain(`CREATE DATABASE "${GENERATED}"`);
    expect(f.queries).toContain(`DROP DATABASE IF EXISTS "${GENERATED}"`);
    expect(f.queries.filter(q => q.startsWith('DROP DATABASE'))).toHaveLength(1);
    // Disposable context is re-verified immediately before destruction.
    expect(f.verifyContext).toHaveBeenCalledTimes(2);
    expect(f.state.databases.has(GENERATED)).toBe(false);
    expect(f.state.databases.has('synchroflow_db')).toBe(true);
    expect(f.output).toEqual([`TEST_DB_CREATED=${GENERATED}`, `TEST_DB_DROPPED=${GENERATED}`,
      'TEST_DB_CLEANUP_OK=zero_orphans_baseline_preserved', 'LIFECYCLE_ERROR=DISPOSABLE_TEST_LIFECYCLE_FAILED']);
    expect(f.output.join('\n')).not.toContain(SECRET);
    expect(f.clients.every(c => c.ended)).toBe(true);
  });

  it('cleanup failure is never reported as success, even for --provision-only', async () => {
    const f = fakes({ orphan: true });
    const code = await runLifecycle({ env: harnessEnv(), argv: ['--provision-only'], deps: f.deps });
    expect(code).toBe(1);
    expect(f.queries).toContain(`DROP DATABASE IF EXISTS "${GENERATED}"`);
    expect(f.output).toContain('CLEANUP_ERROR=DISPOSABLE_TEST_CLEANUP_FAILED');
  });

  it('a valid isolated configuration provisions once and drops the generated database (positive control)', async () => {
    const f = fakes();
    const code = await runLifecycle({ env: harnessEnv(), argv: ['--provision-only'], deps: f.deps });
    expect(code).toBe(0);
    expect(f.provision).toHaveBeenCalledTimes(1);
    expect(f.queries).toContain(`GRANT CONNECT ON DATABASE "${GENERATED}" TO sf_shopify_reconnect_executor`);
    expect(f.state.databases.has(GENERATED)).toBe(false);
    expect(f.spawn).not.toHaveBeenCalled();
  });
});
