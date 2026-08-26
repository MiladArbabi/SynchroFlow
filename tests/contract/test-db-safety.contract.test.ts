// tests/contract/test-db-safety.contract.test.ts
//
// TEST-INFRA-FOUNDATION Slice 2A — contract for the pure test-db safety
// decision boundary (scripts/test-db-safety.js).
//
// This suite calls ONLY the pure safety module. It never connects to
// PostgreSQL, never shells out, never touches the filesystem.

import {
  assertSafeTestDatabase,
  createTestDatabaseName,
  ERROR_CODES,
  TEST_DB_NAME_PATTERN,
} from '../../scripts/test-db-safety';

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
