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
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const { Client } = require('pg');

const REPO_ROOT = path.resolve(__dirname, '..');

const { assertSafeTestDatabase, createTestDatabaseName, assertTestConnections,
  assertNoInheritedDatabaseUrls } = require('./test-db-safety');
const prerequisites = require('./shopify-reconnect-prerequisites');

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
// Never load .env or mutate process.env. A disposable endpoint is independently
// verified before ANY PostgreSQL connection, then every child gets fixed fields.
const refused = () => new Error('DISPOSABLE_TEST_CONTEXT_REJECTED');

function dockerGet(resource) {
  return new Promise((resolve, reject) => {
    const request = http.get({ socketPath: '/var/run/docker.sock', path: resource }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 2000000) request.destroy(refused()); });
      response.on('end', () => {
        try { if (response.statusCode !== 200) throw refused(); resolve(JSON.parse(body)); }
        catch { reject(refused()); }
      });
    });
    request.setTimeout(3000, () => request.destroy(refused()));
    request.on('error', () => reject(refused()));
  });
}

async function verifyDisposableTopology(env) {
  const id = env.SYNCHROFLOW_TEST_POSTGRES_CONTAINER_ID;
  if (!/^[0-9a-f]{64}$/.test(id || '')) throw refused();
  const container = await dockerGet('/containers/' + id + '/json');
  if (container.Id !== id || !container.State.Running
    || !/^postgres:(16|17)$/.test(container.Config.Image)
    || container.Config.Labels?.['synchroflow.disposable-test'] !== '1'
    // Docker reports an option-less tmpfs as '' — require the mount key, not a truthy value.
    || !Object.prototype.hasOwnProperty.call(container.HostConfig.Tmpfs || {}, '/var/lib/postgresql/data')
    || container.Mounts.some(m => m.Type !== 'tmpfs')
    || !container.Config.Env.includes('POSTGRES_USER=' + env.PGMIGRATION_USER)) throw refused();
  const attached = Object.values(container.NetworkSettings.Networks);
  if (attached.length !== 1) throw refused();
  const endpoint = attached[0];
  const network = await dockerGet('/networks/' + endpoint.NetworkID);
  if (network.Driver !== 'bridge' || !network.Containers[id]
    || network.Containers[id].IPv4Address.split('/')[0] !== endpoint.IPAddress) throw refused();
  if (network.Internal === true) {
    // Independently inspect this runtime's membership; a no-default-route
    // assertion alone does not establish the PostgreSQL data-directory lifecycle.
    const selfId = fs.readFileSync('/etc/hostname','utf8').trim();
    if (!/^[0-9a-f]{12,64}$/.test(selfId)) throw refused();
    const self = await dockerGet('/containers/' + selfId + '/json');
    const selfNetworks = Object.values(self.NetworkSettings.Networks);
    if (selfNetworks.length !== 1 || selfNetworks[0].NetworkID !== endpoint.NetworkID
      || Object.keys(container.HostConfig.PortBindings || {}).length !== 0
      || Number(env.PGPORT) !== 5432
      || ![endpoint.IPAddress,...(endpoint.Aliases || []),...(endpoint.DNSNames || [])].includes(env.PGHOST)
      || fs.readFileSync('/proc/net/route','utf8').split('\n').slice(1)
        .some(line => line.trim().split(/\s+/)[1] === '00000000')) throw refused();
  } else {
    // GitHub's ephemeral service bridge: require the independently installed
    // dual-stack OUTPUT deny policy, not CI=true or a service-id flag alone.
    const table = env.OAUTH_ISOLATION_TABLE;
    if (!/^auth_oauth_[0-9]+_[0-9]+$/.test(table || '') || env.PGHOST !== '127.0.0.1') throw refused();
    const policy = JSON.parse(execFileSync('sudo',['-n','nft','-j','list','table','inet',table],{encoding:'utf8'}));
    const chains = policy.nftables.filter(x => x.chain).map(x => x.chain);
    const rules = policy.nftables.filter(x => x.rule).map(x => x.rule.expr);
    if (chains.length !== 1 || chains[0].hook !== 'output' || chains[0].policy !== 'drop'
      || chains[0].prio !== -300 || rules.length !== 5
      || rules[3].at(-1)?.drop !== null || rules[4].at(-1)?.drop !== null
      || !JSON.stringify(rules[3]).includes('ipv4') || !JSON.stringify(rules[4]).includes('ipv6')
      || !JSON.stringify(rules[2]).includes(endpoint.IPAddress)
      || !(container.NetworkSettings.Ports['5432/tcp'] || [])
        .some(b => b.HostPort === env.PGPORT && ['0.0.0.0','127.0.0.1'].includes(b.HostIp))) throw refused();
  }
  return { containerId: id, host: env.PGHOST, port: Number(env.PGPORT) };
}

async function verifyDisposableContext(target, env = process.env) {
  await verifyDisposableTopology(env);
  if (target.host !== env.PGHOST || target.port !== Number(env.PGPORT)
    || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(target.database)) throw refused();
  const client = new Client({ host: env.PGHOST, port: Number(env.PGPORT), database: 'postgres',
    user: env.PGMIGRATION_USER, password: env.PGMIGRATION_PASSWORD,
    connectionTimeoutMillis: 3000, query_timeout: 5000 });
  try {
    await client.connect();
    const r = (await client.query(`SELECT session_user::text AS principal,
      system_identifier::text AS cluster FROM pg_catalog.pg_control_system()`)).rows[0];
    if (r.principal !== env.PGMIGRATION_USER || r.cluster !== target.systemIdentifier) throw refused();
    return { ...target, administrator: r.principal, isolated: true, disposable: true };
  } finally { await client.end(); }
}

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
function buildChildEnv(testDatabase, input = process.env) {
  const url = (user,password) => {
    const u = new URL('postgresql://localhost');
    u.hostname = input.PGHOST; u.port = input.PGPORT; u.pathname = '/' + testDatabase;
    u.username = user; u.password = password; u.searchParams.set('sslmode','disable');
    return u.toString();
  };
  const result = {
    PATH: input.PATH,
    NODE_ENV: 'test',
    PGDATABASE: testDatabase,
    // TEST-DB-ISOLATION-11: positive signal that a disposable synchroflow_test_*
    // DB is in play. backend-core DB config fails closed (never `.env`-falls back
    // to synchroflow_db) when this is set and PGDATABASE is missing/unsafe.
    SYNCHROFLOW_DISPOSABLE_TEST_DB: '1',
    PGHOST: input.PGHOST, PGPORT: input.PGPORT, PGUSER: input.PGUSER,
    PGPASSWORD: input.PGPASSWORD, PGMIGRATION_USER: input.PGMIGRATION_USER,
    PGMIGRATION_PASSWORD: input.PGMIGRATION_PASSWORD,
    SYNCHROFLOW_TEST_POSTGRES_CONTAINER_ID: input.SYNCHROFLOW_TEST_POSTGRES_CONTAINER_ID,
    SYNCHROFLOW_TEST_EXECUTOR_PASSWORD: input.SYNCHROFLOW_TEST_EXECUTOR_PASSWORD,
    DATABASE_URL: url('sf_app',input.PGPASSWORD), APP_DATABASE_URL: url('sf_app',input.PGPASSWORD),
    MIGRATION_DATABASE_URL: url(input.PGMIGRATION_USER,input.PGMIGRATION_PASSWORD),
    SHOPIFY_RECONNECT_DATABASE_URL: url('sf_shopify_reconnect_executor',input.SYNCHROFLOW_TEST_EXECUTOR_PASSWORD),
    OAUTH_ISOLATION_TABLE: input.OAUTH_ISOLATION_TABLE,
    DISABLE_QUEUE: '1', JWT_SECRET: 'ci-jwt-secret', JWT_REFRESH_SECRET: 'ci-refresh-secret',
    ENCRYPTION_KEY: 'ci-encryption-key-0123456789abcdef', SHOPIFY_API_KEY: 'ci-shopify-key',
    SHOPIFY_API_SECRET: 'ci-shopify-secret', SHOPIFY_API_VERSION: '2025-04',
    RESEND_API_KEY: 're_ci_placeholder_not_used', STRIPE_SECRET_KEY: 'sk_test_ci_placeholder_not_used',
  };
  assertTestConnections(result, testDatabase);
  return result;
}

/** True while PUBLIC still holds TEMPORARY or CREATE on the named database. */
const PUBLIC_DATABASE_AUTHORITY_SQL = `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_database d,
    pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
   WHERE d.datname = $1 AND a.grantee = 0
     AND a.privilege_type IN ('TEMPORARY', 'CREATE')) AS public_open`;

function safetyInput(testDatabase, env = process.env) {
  return {
    nodeEnv: 'test',
    testDatabase,
    developmentDatabase: env.PGDATABASE,
    runtimeUser: env.PGUSER,
    migrationUser: env.PGMIGRATION_USER,
  };
}

/**
 * Disposable lifecycle. The CLI always calls this with the real defaults;
 * `deps` exists only so the DB-free safety contract can prove the refusal and
 * cleanup ordering (tests/contract/test-db-safety.contract.test.ts). Returns
 * the process exit code and never prints configuration or driver errors.
 */
async function runLifecycle({ env = process.env, argv = process.argv.slice(2), deps = {} } = {}) {
  const {
    Client: PgClient = Client,
    verifyTopology = verifyDisposableTopology,
    verifyContext = verifyDisposableContext,
    provision = prerequisites.run,
    spawn = spawnSync,
    generateName = createTestDatabaseName,
    log = console.log,
    error = console.error,
  } = deps;
  const testDatabase = generateName();

  // Gate BEFORE any DB connection capable of destructive administration.
  assertSafeTestDatabase(safetyInput(testDatabase, env));
  assertNoInheritedDatabaseUrls(env);
  assertTestConnections({ ...env, NODE_ENV: 'test' });
  if ((env.SYNCHROFLOW_TEST_EXECUTOR_PASSWORD || '').length < 32) throw refused();
  await verifyTopology(env);

  const childCommand = parseChildCommand(argv);

  const maintenance = new PgClient({
    host: env.PGHOST,
    port: Number(env.PGPORT),
    user: env.PGMIGRATION_USER,
    password: env.PGMIGRATION_PASSWORD,
    database: 'postgres',
  });

  let created = false;
  let lifecycleError = null;
  let migrationExitCode = 0;
  let childExitCode = 0;
  let target;

  try {
    await maintenance.connect();

    const identity = await maintenance.query('SELECT current_user');
    if (identity.rows[0].current_user !== env.PGMIGRATION_USER) {
      throw new Error(
        `MAINTENANCE_ROLE_MISMATCH: connected as "${identity.rows[0].current_user}", expected the configured migration role`
      );
    }

    const cluster = (await maintenance.query('SELECT system_identifier::text AS id FROM pg_catalog.pg_control_system()')).rows[0].id;
    target = { host: env.PGHOST, port: Number(env.PGPORT), database: testDatabase,
      systemIdentifier: cluster, tls: 'disable' };
    await verifyContext(target, env);

    // The configured baseline database must already exist on this verified
    // cluster BEFORE anything is created; cleanup proves it still exists.
    const baselineBefore = await maintenance.query(
      'SELECT 1 FROM pg_catalog.pg_database WHERE datname = $1', [env.PGDATABASE]);
    if (baselineBefore.rows.length !== 1) throw refused();

    await maintenance.query(`CREATE DATABASE ${quoteIdentifier(testDatabase)}`);
    created = true;
    log(`TEST_DB_CREATED=${testDatabase}`);

    // S8-C5: a new database grants PUBLIC TEMPORARY by default, and migration
    // 0223 fails closed while the runtime role can create temporary objects.
    // sf_app may not exist yet (0105 creates it), so prove the PUBLIC ACL here
    // and the runtime role's effective privilege after migration.
    await maintenance.query(`REVOKE TEMPORARY ON DATABASE ${quoteIdentifier(testDatabase)} FROM PUBLIC`);
    const publicAuthority = await maintenance.query(PUBLIC_DATABASE_AUTHORITY_SQL, [testDatabase]);
    if (publicAuthority.rows[0]?.public_open !== false) {
      throw new Error('PUBLIC_DATABASE_AUTHORITY_VERIFY_FAILED');
    }

    const provisioned = await provision({ target, administrator: {
      user: env.PGMIGRATION_USER, password: env.PGMIGRATION_PASSWORD },
      mode: 'PROVISION', context: 'disposable-ci', executorPassword: env.SYNCHROFLOW_TEST_EXECUTOR_PASSWORD },
      { verifyDisposableContext: proofTarget => verifyContext(proofTarget, env) });
    log('TEST_DB_ROLES_OK=' + JSON.stringify(provisioned.created));
    await maintenance.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(testDatabase)} TO sf_shopify_reconnect_executor`);
    if (argv.includes('--provision-only')) return 0;

    log(`TEST_DB_MIGRATING=${testDatabase}`);
    const migrateEnv = buildChildEnv(testDatabase, env);
    const migrateResult = spawn(
      'npm',
      ['run', 'migrate', '--workspace', './apps/backend'],
      { cwd: REPO_ROOT, env: migrateEnv, stdio: 'inherit', shell: false }
    );
    if (migrateResult.error) throw migrateResult.error;
    migrationExitCode = migrateResult.status === null ? 1 : migrateResult.status;
    if (migrationExitCode !== 0) {
      throw new Error(`MIGRATION_FAILED: npm run migrate exited ${migrationExitCode}`);
    }
    log(`TEST_DB_MIGRATED=${testDatabase}`);
    await provision({ target, administrator: { user: env.PGMIGRATION_USER,
      password: env.PGMIGRATION_PASSWORD }, phase: 'POST' });
    const executor = new PgClient({ host: env.PGHOST, port: Number(env.PGPORT),
      database: testDatabase, user: 'sf_shopify_reconnect_executor',
      password: env.SYNCHROFLOW_TEST_EXECUTOR_PASSWORD, connectionTimeoutMillis: 3000 });
    try {
      await executor.connect();
      const e = (await executor.query('SELECT session_user AS session_role,current_user AS role,current_database() AS db')).rows[0];
      if (e.session_role !== 'sf_shopify_reconnect_executor' || e.role !== e.session_role || e.db !== testDatabase) throw refused();
      log('TEST_DB_EXECUTOR_OK=' + testDatabase);
    } finally { await executor.end(); }

    // ── Runtime role verification — a NEW connection as PGUSER, never the
    // migration credentials. ──────────────────────────────────────────────
    const runtime = new PgClient({
      host: env.PGHOST,
      port: Number(env.PGPORT),
      user: env.PGUSER,
      password: env.PGPASSWORD,
      database: testDatabase,
    });
    try {
      await runtime.connect();

      const identityCheck = await runtime.query(`
        SELECT
          current_database() AS db,
          current_user AS usr,
          r.rolsuper AS rolsuper,
          r.rolbypassrls AS rolbypassrls,
          has_database_privilege(current_user, current_database(), 'TEMPORARY') AS can_temp,
          has_database_privilege(current_user, current_database(), 'CREATE') AS can_create
        FROM pg_roles r
        WHERE r.rolname = current_user
      `);
      const row = identityCheck.rows[0];

      if (row.db !== testDatabase) {
        throw new Error(`RUNTIME_VERIFY_FAILED: current_database() was "${row.db}"`);
      }
      if (row.usr !== env.PGUSER) {
        throw new Error(`RUNTIME_VERIFY_FAILED: current_user was "${row.usr}"`);
      }
      if (row.rolsuper !== false) {
        throw new Error('RUNTIME_VERIFY_FAILED: runtime role is a superuser');
      }
      if (row.rolbypassrls !== false) {
        throw new Error('RUNTIME_VERIFY_FAILED: runtime role bypasses RLS');
      }
      if (row.can_temp !== false || row.can_create !== false) {
        throw new Error('RUNTIME_VERIFY_FAILED: runtime role can create database objects');
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

      log(`TEST_DB_RUNTIME_OK=${testDatabase}`);
    } finally {
      // Close the harness's own runtime client as soon as it is no longer
      // needed — well before cleanup/DROP is ever attempted, which already
      // satisfies "close the harness runtime client before DROP".
      await runtime.end();
    }

    // ── Optional child command (Slice 2C foundation; unused in Slice 2B) ──
    if (childCommand.length > 0) {
      const [cmd, ...args] = childCommand;
      const childEnv = buildChildEnv(testDatabase, env);
      const childResult = spawn(cmd, args, {
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
        assertSafeTestDatabase(safetyInput(testDatabase, env));
        await verifyContext(target, env);

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

        log(`TEST_DB_DROPPED=${testDatabase}`);
        const inventory = await maintenance.query(`SELECT datname FROM pg_catalog.pg_database
          WHERE datname LIKE 'synchroflow_test\\_%' ESCAPE '\\'`);
        if (inventory.rows.length !== 0) throw refused();
        const baseline = await maintenance.query('SELECT 1 FROM pg_catalog.pg_database WHERE datname=$1',[env.PGDATABASE]);
        if (baseline.rows.length !== 1) throw refused();
        log('TEST_DB_CLEANUP_OK=zero_orphans_baseline_preserved');
      }
    } catch (err) {
      cleanupError = err;
    } finally {
      await maintenance.end();
    }

    if (lifecycleError) {
      error('LIFECYCLE_ERROR=DISPOSABLE_TEST_LIFECYCLE_FAILED');
    }
    if (cleanupError) {
      error('CLEANUP_ERROR=DISPOSABLE_TEST_CLEANUP_FAILED');
    }
    // Decided here (as before) so cleanup failure also overrides the
    // --provision-only early return.
    // eslint-disable-next-line no-unsafe-finally
    return lifecycleError || cleanupError ? 1 : childCommand.length > 0 ? childExitCode : 0;
  }
}

module.exports = { buildChildEnv, verifyDisposableContext, verifyDisposableTopology, runLifecycle };
if (require.main === module) {
  runLifecycle().then(code => { process.exitCode = code; },
    () => { console.error('DISPOSABLE_TEST_CONTEXT_REJECTED'); process.exitCode = 1; });
}
