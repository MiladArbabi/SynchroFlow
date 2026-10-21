#!/usr/bin/env node
'use strict';

// No dotenv, application imports, credential defaults or production provisioning.
// PROVISION is a library operation for a trusted disposable-cluster orchestrator:
// verifyDisposableContext must independently inspect isolation, not echo input or
// trust NODE_ENV/a name/CI=true. No CLI/env switch supplies that capability.
// Production bootstrap and password rotation remain separate operator work.
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const E = 'sf_shopify_reconnect_executor';
const O = 'sf_shopify_reconnect_owner';
// GH-1068 T3-B: 0216 evolves the 0215 finalizer; its postconditions carry every
// 0215 invariant and are the current authoritative reconnect contract.
// GH-1101: 0217 evolves the 0216 dispatch claim; its postconditions carry every
// 0215/0216 invariant.
// GH-979 C: 0220 adds exactly the state-bound finalizer overload and recovery
// proof. The APPLIED migration ledger, never an on-disk file, selects the epoch:
// before 0220 the 0217 contract applies unchanged; after it, 0220's.
const MIGRATIONS_DIR = path.resolve(__dirname, '../apps/backend/migrations');
const LEGACY_FINALIZER =
  'shopify_reconnect_private.finalize_reconnect(integer,integer,text,text,bigint,uuid,text,text,timestamptz,timestamptz,text,text,text,text)';
const STATE_BOUND_FINALIZER =
  'shopify_reconnect_private.finalize_reconnect(integer,integer,text,text,bigint,uuid,text,text,timestamptz,timestamptz,text,text,text,text,text)';
const EPOCHS = Object.freeze({
  '0217': Object.freeze({ migration: '20261019120000_0217_shopify_manual_recovery',
    security: '0215_VALIDATED', ownedFunctions: Object.freeze([LEGACY_FINALIZER]) }),
  '0220': Object.freeze({ migration: '20261021130000_0220_add_state_bound_shopify_reconnect_proof',
    security: '0220_VALIDATED', ownedFunctions: Object.freeze([LEGACY_FINALIZER, STATE_BOUND_FINALIZER]) }),
});
const reject = () => new Error('SHOPIFY_RECONNECT_PREREQUISITES_REJECTED');

// Narrow provisioning facts only. Full migration security/body/ACL validation
// is owned by the current reconnect migration and delegated below, never reimplemented here.
const ROLE_FACTS = `
  SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
    r.rolcreatedb, r.rolcreaterole, r.rolreplication,
    EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
      WHERE m.member=r.oid OR m.roleid=r.oid) AS membership,
    (EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datdba=r.oid)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner=r.oid)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relowner=r.oid)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proowner=r.oid
        AND NOT (r.rolname='sf_shopify_reconnect_owner' AND oid IN (
          SELECT COALESCE(pg_catalog.to_regprocedure(allowed)::oid,0)
          FROM pg_catalog.unnest($3::text[]) allowed))))
      AS unexpected_ownership,
    pg_catalog.has_schema_privilege(r.oid,'public','CREATE') AS public_create,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp'
        AND c.relkind IN ('r','p','v','m','f')
        AND (pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'INSERT,UPDATE,REFERENCES')))
      AS table_write
  FROM pg_catalog.pg_roles r WHERE r.rolname IN ($1,$2)
`;
const PUBLIC_FACTS = `
  SELECT
    EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,
      LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
      WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type='CREATE')
      AS public_create,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp'
        AND c.relkind IN ('r','p','v','m','f') AND a.grantee=0
        AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute col
      JOIN pg_catalog.pg_class c ON c.oid=col.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
      WHERE n.nspname NOT IN ('pg_catalog','information_schema')
        AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp'
        AND c.relkind IN ('r','p','v','m','f') AND a.grantee=0
        AND a.privilege_type IN ('INSERT','UPDATE','REFERENCES')) AS public_write,
    EXISTS (SELECT 1 FROM pg_catalog.pg_namespace
      WHERE nspname='shopify_reconnect_private') AS private_schema
`;

// Read-only: which reconnect security evolutions the target has APPLIED.
const LEDGER_FACTS = `
  SELECT pg_catalog.to_regclass('public.knex_migrations') IS NOT NULL AS ledger
`;
const APPLIED_EVOLUTIONS = `
  SELECT name FROM public.knex_migrations WHERE name = ANY($1::text[])
`;

async function securityEpoch(client) {
  const ledger = (await client.query(LEDGER_FACTS)).rows;
  if (ledger.length !== 1 || typeof ledger[0].ledger !== 'boolean') throw reject();
  if (!ledger[0].ledger) return '0217';
  const names = Object.values(EPOCHS).flatMap(e => [`${e.migration}.js`, `${e.migration}.ts`]);
  const applied = (await client.query(APPLIED_EVOLUTIONS, [names])).rows.map(r => r.name);
  if (applied.some(name => !names.includes(name))) throw reject();
  const has = epoch => applied.some(name => name.startsWith(`${EPOCHS[epoch].migration}.`));
  // An evolution is never valid without its predecessor.
  if (has('0220') && !has('0217')) throw reject();
  return has('0220') ? '0220' : '0217';
}

function configuration(input) {
  const c = { ...input, target: { ...input?.target }, administrator: { ...input?.administrator },
    mode: input?.mode ?? 'CHECK', phase: input?.phase ?? 'PRE' };
  if (!['CHECK', 'PROVISION'].includes(c.mode) || !['PRE', 'POST'].includes(c.phase)
    || !c.target || !c.administrator) throw reject();
  for (const value of [c.target.host, c.target.database, c.target.systemIdentifier,
    c.administrator.user, c.administrator.password]) {
    if (typeof value !== 'string' || !value || value.includes('\0')) throw reject();
  }
  if (!/^\d+$/.test(c.target.systemIdentifier)
    || !Number.isInteger(c.target.port) || c.target.port < 1 || c.target.port > 65535
    || ['sf_app', E, O].includes(c.administrator.user)
    || !['verify-full', 'disable'].includes(c.target.tls ?? 'verify-full')) throw reject();
  if (c.mode === 'PROVISION' && (typeof c.executorPassword !== 'string'
    || c.executorPassword.length < 32 || c.executorPassword.includes('\0'))) throw reject();
  return c;
}

function connection(c, database = c.target.database) {
  return {
    host: c.target.host, port: c.target.port, database,
    user: c.administrator.user, password: c.administrator.password,
    ssl: c.target.tls === 'disable' ? false : { rejectUnauthorized: true },
    connectionTimeoutMillis: 3000, statement_timeout: 5000,
    query_timeout: 6000, lock_timeout: 2000,
    idle_in_transaction_session_timeout: 10000,
    options: '-c search_path=pg_catalog,pg_temp',
    application_name: 'shopify-reconnect-prerequisites',
  };
}

async function identity(client, c, database = c.target.database) {
  const result = await client.query(`SELECT current_database() AS database,
    session_user::text AS session_user, current_user::text AS current_user,
    r.rolsuper, control.system_identifier::text AS system_identifier
    FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_control_system() control
    WHERE r.rolname=session_user`);
  const r = result.rows[0];
  // Superuser is deliberately required: CREATEROLE/SET ROLE memberships cannot
  // safely replace 0215's ownership transfer under its zero-membership contract.
  if (result.rows.length !== 1 || r.database !== database
    || r.session_user !== c.administrator.user || r.current_user !== c.administrator.user
    || r.rolsuper !== true || r.system_identifier !== c.target.systemIdentifier) throw reject();
}

function validateRoles(rows, allowMissing) {
  if (rows.length > 2 || new Set(rows.map(r => r.rolname)).size !== rows.length) throw reject();
  for (const name of [E, O]) {
    const r = rows.find(row => row.rolname === name);
    if (!r) { if (!allowMissing) throw reject(); continue; }
    if (r.rolcanlogin !== (name === E)
      || ['rolsuper', 'rolbypassrls', 'rolcreatedb', 'rolcreaterole', 'rolreplication',
        'membership', 'unexpected_ownership', 'public_create'].some(key => r[key] !== false)
      || (name === E && r.table_write !== false)) throw reject();
  }
  if (rows.some(r => ![E, O].includes(r.rolname))) throw reject();
}

async function facts(client, allowMissing, epoch) {
  const roles = (await client.query(ROLE_FACTS, [E, O, [...EPOCHS[epoch].ownedFunctions]])).rows;
  const result = await client.query(PUBLIC_FACTS);
  const p = result.rows[0];
  if (result.rows.length !== 1 || p.public_create !== false || p.public_write !== false
    || typeof p.private_schema !== 'boolean') throw reject();
  validateRoles(roles, allowMissing);
  return { roles, privateSchema: p.private_schema };
}

async function authoritativePostcheck(client, epoch) {
  // Compile ONLY the fixed migration of the applied epoch in memory. Its imports
  // are type only; evaluating definitions does not run UP/DOWN or load
  // application code. No stale dist fallback and no generated file. TypeScript
  // is an explicit operator-tool dependency, already installed by npm ci.
  const migration = path.join(MIGRATIONS_DIR, `${EPOCHS[epoch].migration}.ts`);
  const ts = require('typescript');
  const output = ts.transpileModule(fs.readFileSync(migration, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: /** @type {Record<string, Function>} */ ({}) };
  vm.runInNewContext(output, sandbox, { filename: migration, timeout: 1000 });
  if (typeof sandbox.exports.assertSecurityPostconditions !== 'function') throw reject();
  await sandbox.exports.assertSecurityPostconditions({ raw: sql => client.query(sql) });
}

// PostgreSQL DDL cannot bind a PASSWORD parameter. Send a SCRAM verifier rather
// than plaintext, using only locally generated base64/digits in a fixed DDL shape.
// Never log SQL, verifiers or driver errors; server diagnostic policy remains
// operator-owned. This utility never returns credential/verifier material.
function verifier(password) {
  const salt = crypto.randomBytes(16);
  const salted = crypto.pbkdf2Sync(password, salt, 16384, 32, 'sha256');
  const clientKey = crypto.createHmac('sha256', salted).update('Client Key').digest();
  const stored = crypto.createHash('sha256').update(clientKey).digest('base64');
  const server = crypto.createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$16384:${salt.toString('base64')}$${stored}:${server}`;
}

async function run(input, dependencies = {}) {
  let client, lockClient, transaction = false, result, failed = false, epoch;
  try {
    const c = configuration(input);
    if (c.mode === 'PROVISION') {
      if (c.context !== 'disposable-ci' || typeof dependencies.verifyDisposableContext !== 'function') throw reject();
      const proof = await dependencies.verifyDisposableContext(Object.freeze({ ...c.target }));
      if (!proof || proof.isolated !== true || proof.disposable !== true
        || proof.administrator !== c.administrator.user
        || ['host', 'port', 'database', 'systemIdentifier'].some(k => proof[k] !== c.target[k])
        || !/^synchroflow_test_[A-Za-z0-9_]+$/.test(c.target.database)) throw reject();
    }
    const createClient = dependencies.createClient ?? (options => new (require('pg').Client)(options));
    client = createClient(connection(c));
    await client.connect();
    await identity(client, c);
    if (c.mode === 'PROVISION') {
      // Roles are cluster-global. All target DBs serialize through the SAME
      // fixed maintenance DB, not independent database-local lock namespaces.
      lockClient = createClient(connection(c, 'postgres'));
      await lockClient.connect();
      await identity(lockClient, c, 'postgres');
      await lockClient.query('BEGIN');
      await lockClient.query("SELECT pg_catalog.pg_advisory_xact_lock(1068, 215)");
    }
    await client.query(c.mode === 'CHECK' ? 'BEGIN READ ONLY' : 'BEGIN');
    transaction = true;
    epoch = await securityEpoch(client);
    const before = await facts(client, c.mode === 'PROVISION', epoch);
    // Existing private authority must already satisfy its applied epoch, even in PRE mode.
    if (c.phase === 'POST' || before.privateSchema) await authoritativePostcheck(client, epoch);
    const created = [];
    if (c.mode === 'PROVISION') {
      if (!before.roles.some(r => r.rolname === E)) {
        await client.query(`CREATE ROLE sf_shopify_reconnect_executor LOGIN NOSUPERUSER
          NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${verifier(c.executorPassword)}'`);
        created.push(E);
      }
      if (!before.roles.some(r => r.rolname === O)) {
        await client.query(`CREATE ROLE sf_shopify_reconnect_owner NOLOGIN NOSUPERUSER
          NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
        created.push(O);
      }
      await facts(client, false, epoch);
    }
    await client.query('COMMIT');
    transaction = false;
    result = { mode: c.mode, phase: c.phase, created,
      security: c.phase === 'POST' || before.privateSchema
        ? EPOCHS[epoch].security : 'ROLE_PREREQUISITES_ONLY' };
  } catch {
    failed = true;
    if (transaction) { try { await client.query('ROLLBACK'); } catch { /* close below */ } }
  } finally {
    // Closing the maintenance session releases its transaction-scoped lock.
    for (const c of [client, lockClient]) {
      if (c) { try { await c.end(); } catch { failed = true; } }
    }
  }
  // No causes, SQLSTATEs, messages, URLs or configuration escape this boundary.
  if (failed) throw reject();
  return result;
}

function fromEnvironment(env, argv) {
  if (argv.length > 1 || (argv[0] !== undefined && !['CHECK', 'PROVISION'].includes(argv[0]))) throw reject();
  return {
    mode: argv[0] ?? 'CHECK', phase: env.RECONNECT_CHECK_PHASE ?? 'PRE',
    target: { host: env.RECONNECT_TARGET_HOST, port: Number(env.RECONNECT_TARGET_PORT),
      database: env.RECONNECT_TARGET_DATABASE, systemIdentifier: env.RECONNECT_TARGET_SYSTEM_IDENTIFIER,
      tls: env.RECONNECT_TARGET_TLS ?? 'verify-full' },
    administrator: { user: env.RECONNECT_ADMIN_USER, password: env.RECONNECT_ADMIN_PASSWORD },
  };
}

module.exports = { run, fromEnvironment };
if (require.main === module) {
  Promise.resolve().then(() => run(fromEnvironment(process.env, process.argv.slice(2))))
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error('SHOPIFY_RECONNECT_PREREQUISITES_REJECTED'); process.exitCode = 1; });
}
