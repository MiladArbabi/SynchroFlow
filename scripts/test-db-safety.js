#!/usr/bin/env node
/* scripts/test-db-safety.js
 *
 * TEST-INFRA-FOUNDATION Slice 2A — fail-closed test-database identity/safety
 * decision boundary.
 *
 * This module is PURE:
 *   - no child_process / shell execution
 *   - no SQL
 *   - no filesystem access or deletion
 *   - no database connection
 *   - no environment mutation
 *
 * It answers exactly one question — "is it safe to point a disposable test
 * run at this database, under these roles?" — from explicit inputs only.
 * Callers are responsible for sourcing those inputs (env vars, CLI flags,
 * etc.) and for actually creating/dropping/migrating anything; this module
 * never does so itself.
 */

'use strict';

/** Approved disposable test-database naming contract. */
const TEST_DB_NAME_PATTERN = /^synchroflow_test_[A-Za-z0-9_]+$/;

/** Stable, machine-readable error identifiers. Do not rename — callers may
 *  branch on `error.code`. */
const ERROR_CODES = Object.freeze({
  UNSAFE_NODE_ENV: 'UNSAFE_NODE_ENV',
  UNSAFE_TEST_DB_NAME: 'UNSAFE_TEST_DB_NAME',
  TEST_DB_EQUALS_DEV_DB: 'TEST_DB_EQUALS_DEV_DB',
  MISSING_DEV_DB: 'MISSING_DEV_DB',
  MISSING_RUNTIME_USER: 'MISSING_RUNTIME_USER',
  MISSING_MIGRATION_USER: 'MISSING_MIGRATION_USER',
  ROLE_SEPARATION_REQUIRED: 'ROLE_SEPARATION_REQUIRED',
});

/**
 * TestDbSafetyError — thrown by assertSafeTestDatabase().
 * `code` is the stable identifier; `message` is human-readable context.
 */
class TestDbSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TestDbSafetyError';
    this.code = code;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * assertSafeTestDatabase(input)
 *
 * Throws TestDbSafetyError (see ERROR_CODES) on the first violated
 * invariant, in this fixed order:
 *
 *   1. nodeEnv must be exactly 'test'
 *   2. testDatabase must be non-empty and match TEST_DB_NAME_PATTERN
 *   3. testDatabase must not equal developmentDatabase
 *   4. developmentDatabase must be non-empty
 *   5. runtimeUser must be non-empty
 *   6. migrationUser must be non-empty
 *   7. runtimeUser must not equal migrationUser
 *
 * Returns nothing (void) when every invariant holds.
 *
 * @param {{
 *   nodeEnv: string,
 *   testDatabase: string,
 *   developmentDatabase: string,
 *   runtimeUser: string,
 *   migrationUser: string,
 * }} input
 */
function assertSafeTestDatabase(input) {
  const {
    nodeEnv,
    testDatabase,
    developmentDatabase,
    runtimeUser,
    migrationUser,
  } = input || {};

  if (nodeEnv !== 'test') {
    throw new TestDbSafetyError(
      ERROR_CODES.UNSAFE_NODE_ENV,
      `Refusing to touch a test database outside NODE_ENV=test (got: ${JSON.stringify(nodeEnv)}).`
    );
  }

  if (!isNonEmptyString(testDatabase) || !TEST_DB_NAME_PATTERN.test(testDatabase)) {
    throw new TestDbSafetyError(
      ERROR_CODES.UNSAFE_TEST_DB_NAME,
      `Test database name must be non-empty and match ${TEST_DB_NAME_PATTERN} (got: ${JSON.stringify(testDatabase)}).`
    );
  }

  if (testDatabase === developmentDatabase) {
    throw new TestDbSafetyError(
      ERROR_CODES.TEST_DB_EQUALS_DEV_DB,
      `Test database must not equal the development database (both were: ${JSON.stringify(testDatabase)}).`
    );
  }

  if (!isNonEmptyString(developmentDatabase)) {
    throw new TestDbSafetyError(
      ERROR_CODES.MISSING_DEV_DB,
      'developmentDatabase must be a non-empty string.'
    );
  }

  if (!isNonEmptyString(runtimeUser)) {
    throw new TestDbSafetyError(
      ERROR_CODES.MISSING_RUNTIME_USER,
      'runtimeUser must be a non-empty string.'
    );
  }

  if (!isNonEmptyString(migrationUser)) {
    throw new TestDbSafetyError(
      ERROR_CODES.MISSING_MIGRATION_USER,
      'migrationUser must be a non-empty string.'
    );
  }

  if (runtimeUser === migrationUser) {
    throw new TestDbSafetyError(
      ERROR_CODES.ROLE_SEPARATION_REQUIRED,
      `runtimeUser and migrationUser must be distinct roles (both were: ${JSON.stringify(runtimeUser)}).`
    );
  }
}

/**
 * createTestDatabaseName()
 *
 * Generates a disposable test-database name that always satisfies
 * TEST_DB_NAME_PATTERN, mixing process id + high-resolution time + random
 * bytes for collision resistance across concurrent/parallel runs. Never
 * returns the literal production/development name 'synchroflow_db' — the
 * fixed 'synchroflow_test_' prefix makes that structurally impossible.
 *
 * No third-party packages: entropy comes from Node's built-in `crypto` and
 * `process.hrtime.bigint()`.
 *
 * @returns {string}
 */
function createTestDatabaseName() {
  const crypto = require('crypto');

  const pid = process.pid.toString(36);
  const hrtime = process.hrtime.bigint().toString(36);
  const random = crypto.randomBytes(6).toString('hex');

  const name = `synchroflow_test_${pid}_${hrtime}_${random}`;

  // Defensive: guarantee the contract this function promises, even if the
  // composition above is changed later.
  if (!TEST_DB_NAME_PATTERN.test(name)) {
    throw new TestDbSafetyError(
      ERROR_CODES.UNSAFE_TEST_DB_NAME,
      `createTestDatabaseName() produced a name violating its own contract: ${name}`
    );
  }

  return name;
}

/** Pure complete-connection guard; the original seven public IDs stay intact. */
function assertTestConnections(env, expectedDatabase = env.PGDATABASE) {
  const fail = () => { throw new Error('UNSAFE_TEST_CONNECTION_CONFIGURATION'); };
  if (env.NODE_ENV !== 'test' || env.PGUSER !== 'sf_app'
    || !isNonEmptyString(env.PGHOST) || !/^[0-9]+$/.test(env.PGPORT || '')
    || Number(env.PGPORT) < 1 || Number(env.PGPORT) > 65535
    || !isNonEmptyString(expectedDatabase) || env.PGDATABASE !== expectedDatabase
    || !isNonEmptyString(env.PGPASSWORD) || !isNonEmptyString(env.PGMIGRATION_PASSWORD)
    || !isNonEmptyString(env.PGMIGRATION_USER)
    || ['sf_app','sf_shopify_reconnect_executor','sf_shopify_reconnect_owner'].includes(env.PGMIGRATION_USER)) fail();
  for (const key of ['PGSERVICE','PGSERVICEFILE','PGPASSFILE','PGOPTIONS','PGHOSTADDR',
    'PGSSLCERT','PGSSLKEY','PGSSLROOTCERT','PGSSLCRL']) if (env[key] !== undefined) fail();
  if (env.PGSSLMODE !== undefined && env.PGSSLMODE !== 'disable') fail();
  const users = { DATABASE_URL: 'sf_app', APP_DATABASE_URL: 'sf_app',
    MIGRATION_DATABASE_URL: env.PGMIGRATION_USER,
    SHOPIFY_RECONNECT_DATABASE_URL: 'sf_shopify_reconnect_executor' };
  for (const [key,user] of Object.entries(users)) {
    if (env[key] === undefined) continue;
    let u; try { u = new URL(env[key]); } catch { fail(); }
    if (!['postgres:','postgresql:'].includes(u.protocol) || u.hostname !== env.PGHOST
      || Number(u.port || 5432) !== Number(env.PGPORT)
      || decodeURIComponent(u.pathname.slice(1)) !== expectedDatabase
      || decodeURIComponent(u.username) !== user || !u.password || u.hash
      || [...u.searchParams].some(([k,v]) => k !== 'sslmode' || v !== 'disable')) fail();
    const password = user === 'sf_app' ? env.PGPASSWORD : user === env.PGMIGRATION_USER
      ? env.PGMIGRATION_PASSWORD : env.SYNCHROFLOW_TEST_EXECUTOR_PASSWORD;
    if (!password || decodeURIComponent(u.password) !== password) fail();
  }
}

/** Connection URLs the disposable harness generates itself for each run. */
const HARNESS_DATABASE_URL_KEYS = Object.freeze(['DATABASE_URL', 'APP_DATABASE_URL',
  'MIGRATION_DATABASE_URL', 'SHOPIFY_RECONNECT_DATABASE_URL']);

/**
 * Pure inherited-configuration guard for the harness ORCHESTRATOR environment.
 * Every harness URL targets a database name generated at runtime, so no
 * inherited value (including an empty string) can be compatible with it.
 * Refuse rather than rely on the child environment replacing it later.
 */
function assertNoInheritedDatabaseUrls(env) {
  for (const key of HARNESS_DATABASE_URL_KEYS) {
    if (env[key] !== undefined) throw new Error('UNSAFE_TEST_CONNECTION_CONFIGURATION');
  }
}

module.exports = {
  assertSafeTestDatabase,
  createTestDatabaseName,
  TestDbSafetyError,
  ERROR_CODES,
  TEST_DB_NAME_PATTERN,
  assertTestConnections,
  assertNoInheritedDatabaseUrls,
  HARNESS_DATABASE_URL_KEYS,
};
