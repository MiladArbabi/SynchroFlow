#!/usr/bin/env node
/* scripts/with-test-db.js
 *
 * TEST-INFRA-FOUNDATION Slice 2B — reusable disposable-PostgreSQL lifecycle.
 *
 *   generate safe test DB name
 *   -> create it with the migration role
 *   -> migrate it (existing canonical `npm run migrate --workspace ./apps/backend`)
 *   -> verify the restricted runtime role can reach it, is non-superuser,
 *      does not bypass RLS, and that migrated schema is present
 *   -> [optional, foundation only — see Step 5 below] run a caller-supplied
 *      child command against it
 *   -> ALWAYS drop it and prove it is gone, even on failure
 *
 * This script performs real, destructive PostgreSQL administration (CREATE
 * DATABASE / DROP DATABASE). Every such operation is gated by
 * scripts/test-db-safety.js's assertSafeTestDatabase() — imported, not
 * duplicated — called immediately before both creation and destruction.
 * The database name is never accepted from a caller; it is always the
 * output of createTestDatabaseName(), which this script then validates like
 * any other input.
 *
 * Usage:
 *   node scripts/with-test-db.js
 *   node scripts/with-test-db.js -- <command> <args...>   (Slice 2C runner;
 *     the child command runs only after successful migration + runtime
 *     verification, with its own generated-test-DB environment, and cleanup
 *     still always runs afterward. Not exercised in Slice 2B.)
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const { Client } = require('pg');

const REPO_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const { assertSafeTestDatabase, createTestDatabaseName } = require('./test-db-safety');

/**
 * This harness's only valid operating mode is 'test' — it exists solely to
 * create, migrate, verify, and drop disposable test databases. Root .env
 * defaults NODE_ENV to 'development' for normal dev/runtime use, so that
 * value is explicitly overridden here rather than trusted, and passed
 * through assertSafeTestDatabase() like every other input rather than
 * assumed safe. This is the one intentional global process.env mutation in
 * this file; everything the migration/child subprocess sees is built as a
 * separate env object (buildChildEnv), never by mutating process.env
 * further.
 */
process.env.NODE_ENV = 'test';

function quoteIdentifier(identifier) {
  // Postgres identifiers cannot be parameter-bound in DDL. `identifier` is
  // always the output of createTestDatabaseName() (charset
  // [A-Za-z0-9_] plus the fixed 'synchroflow_test_' prefix) re-validated by
  // assertSafeTestDatabase() immediately before this is ever called — this
  // quoting is defense-in-depth, not the primary safety mechanism.
  return '"' + String(identifier).replace(/"/g, '""') + '"';
}

/** Everything after a literal `--` in argv is the optional child command. */
function parseChildCommand(argv) {
  const sepIndex = argv.indexOf('--');
  if (sepIndex === -1) return [];
  return argv.slice(sepIndex + 1);
}

/** Build an isolated env object for a subprocess. Never mutates process.env. */
function buildChildEnv(testDatabase) {
  return Object.assign({}, process.env, {
    NODE_ENV: 'test',
    PGDATABASE: testDatabase,
    // TEST-DB-ISOLATION-11: positive signal that a disposable synchroflow_test_*
    // DB is in play. backend-core DB config fails closed (never `.env`-falls back
    // to synchroflow_db) when this is set and PGDATABASE is missing/unsafe.
    SYNCHROFLOW_DISPOSABLE_TEST_DB: '1',
    PGHOST: process.env.PGHOST,
    PGPORT: process.env.PGPORT,
    PGUSER: process.env.PGUSER,
    PGPASSWORD: process.env.PGPASSWORD,
    PGMIGRATION_USER: process.env.PGMIGRATION_USER,
    PGMIGRATION_PASSWORD: process.env.PGMIGRATION_PASSWORD,
  });
}

function safetyInput(testDatabase) {
  return {
    nodeEnv: process.env.NODE_ENV,
    testDatabase,
    developmentDatabase: process.env.PGDATABASE,
    runtimeUser: process.env.PGUSER,
    migrationUser: process.env.PGMIGRATION_USER,
  };
}

async function main() {
  const testDatabase = createTestDatabaseName();

  // Gate BEFORE any DB connection capable of destructive administration.
  assertSafeTestDatabase(safetyInput(testDatabase));

  const childCommand = parseChildCommand(process.argv.slice(2));

  const maintenance = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT),
    user: process.env.PGMIGRATION_USER,
    password: process.env.PGMIGRATION_PASSWORD,
    database: 'postgres',
  });

  let created = false;
  let lifecycleError = null;
  let migrationExitCode = 0;
  let childExitCode = 0;

  try {
    await maintenance.connect();

    const identity = await maintenance.query('SELECT current_user');
    if (identity.rows[0].current_user !== process.env.PGMIGRATION_USER) {
      throw new Error(
        `MAINTENANCE_ROLE_MISMATCH: connected as "${identity.rows[0].current_user}", expected the configured migration role`
      );
    }

    await maintenance.query(`CREATE DATABASE ${quoteIdentifier(testDatabase)}`);
    created = true;
    console.log(`TEST_DB_CREATED=${testDatabase}`);

    console.log(`TEST_DB_MIGRATING=${testDatabase}`);
    const migrateEnv = buildChildEnv(testDatabase);
    const migrateResult = spawnSync(
      'npm',
      ['run', 'migrate', '--workspace', './apps/backend'],
      { cwd: REPO_ROOT, env: migrateEnv, stdio: 'inherit', shell: false }
    );
    if (migrateResult.error) throw migrateResult.error;
    migrationExitCode = migrateResult.status === null ? 1 : migrateResult.status;
    if (migrationExitCode !== 0) {
      throw new Error(`MIGRATION_FAILED: npm run migrate exited ${migrationExitCode}`);
    }
    console.log(`TEST_DB_MIGRATED=${testDatabase}`);

    // ── Runtime role verification — a NEW connection as PGUSER, never the
    // migration credentials. ──────────────────────────────────────────────
    const runtime = new Client({
      host: process.env.PGHOST,
      port: Number(process.env.PGPORT),
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: testDatabase,
    });
    try {
      await runtime.connect();

      const identityCheck = await runtime.query(`
        SELECT
          current_database() AS db,
          current_user AS usr,
          r.rolsuper AS rolsuper,
          r.rolbypassrls AS rolbypassrls
        FROM pg_roles r
        WHERE r.rolname = current_user
      `);
      const row = identityCheck.rows[0];

      if (row.db !== testDatabase) {
        throw new Error(`RUNTIME_VERIFY_FAILED: current_database() was "${row.db}"`);
      }
      if (row.usr !== process.env.PGUSER) {
        throw new Error(`RUNTIME_VERIFY_FAILED: current_user was "${row.usr}"`);
      }
      if (row.rolsuper !== false) {
        throw new Error('RUNTIME_VERIFY_FAILED: runtime role is a superuser');
      }
      if (row.rolbypassrls !== false) {
        throw new Error('RUNTIME_VERIFY_FAILED: runtime role bypasses RLS');
      }

      // Schema-presence proof, non-mutating: the knex migration-tracking
      // table (always created by the migration run itself) AND 'shops',
      // the first application table created by the very first migration
      // (apps/backend/migrations/20260212160151_0001_sovereign_baseline.ts)
      // with no conditional guard — confirmed canonical/unconditional by
      // reading that migration before relying on it here.
      const schemaCheck = await runtime.query(`
        SELECT
          to_regclass('public.knex_migrations') IS NOT NULL AS has_migrations_table,
          to_regclass('public.shops')           IS NOT NULL AS has_shops_table
      `);
      const schemaRow = schemaCheck.rows[0];
      if (!schemaRow.has_migrations_table || !schemaRow.has_shops_table) {
        throw new Error(
          `RUNTIME_VERIFY_FAILED: expected schema objects missing (knex_migrations=${schemaRow.has_migrations_table}, shops=${schemaRow.has_shops_table})`
        );
      }

      console.log(`TEST_DB_RUNTIME_OK=${testDatabase}`);
    } finally {
      // Close the harness's own runtime client as soon as it is no longer
      // needed — well before cleanup/DROP is ever attempted, which already
      // satisfies "close the harness runtime client before DROP".
      await runtime.end();
    }

    // ── Optional child command (Slice 2C foundation; unused in Slice 2B) ──
    if (childCommand.length > 0) {
      const [cmd, ...args] = childCommand;
      const childEnv = buildChildEnv(testDatabase);
      const childResult = spawnSync(cmd, args, {
        cwd: REPO_ROOT,
        env: childEnv,
        stdio: 'inherit',
        shell: false,
      });
      if (childResult.error) throw childResult.error;
      childExitCode = childResult.status === null ? 1 : childResult.status;
    }
  } catch (err) {
    lifecycleError = err;
  } finally {
    let cleanupError = null;

    try {
      if (created) {
        // Re-validate immediately before any terminate/drop operation too.
        assertSafeTestDatabase(safetyInput(testDatabase));

        // Terminate any remaining backends for the validated test database
        // ONLY — parameter-bound, never string-interpolated, and never
        // targeting developmentDatabase/'postgres'/anything else.
        await maintenance.query(
          `SELECT pg_terminate_backend(pid)
             FROM pg_stat_activity
            WHERE datname = $1
              AND pid <> pg_backend_pid()`,
          [testDatabase]
        );

        await maintenance.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(testDatabase)}`);

        const stillThere = await maintenance.query(
          'SELECT 1 FROM pg_database WHERE datname = $1',
          [testDatabase]
        );
        if (stillThere.rows.length !== 0) {
          throw new Error(`CLEANUP_VERIFY_FAILED: "${testDatabase}" still exists after DROP DATABASE`);
        }

        console.log(`TEST_DB_DROPPED=${testDatabase}`);
      }
    } catch (err) {
      cleanupError = err;
    } finally {
      await maintenance.end();
    }

    if (lifecycleError) {
      console.error(`LIFECYCLE_ERROR=${lifecycleError.message}`);
    }
    if (cleanupError) {
      console.error(`CLEANUP_ERROR=${cleanupError.message}`);
    }

    if (lifecycleError || cleanupError) {
      process.exitCode = 1;
      return;
    }

    process.exitCode = childCommand.length > 0 ? childExitCode : 0;
  }
}

main();
