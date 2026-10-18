// Pure/mocked orchestration contracts only. No PostgreSQL connection, role
// provisioning, Docker, dotenv, application imports or generated artifacts.
const { run, fromEnvironment } = require('../../scripts/shopify-reconnect-prerequisites');

const E = 'sf_shopify_reconnect_executor';
const O = 'sf_shopify_reconnect_owner';
const SECRET = "SENTINEL-executor-password-32-characters-'-$-sensitive";
const ADMIN_SECRET = 'SENTINEL-administrator-password';

function config() {
  return {
    target: { host: 'isolated-postgres', port: 5432,
      database: 'synchroflow_test_roles', systemIdentifier: '123456789', tls: 'disable' },
    administrator: { user: 'isolated_admin', password: ADMIN_SECRET },
  };
}

function role(name: string) {
  return { rolname: name, rolcanlogin: name === E, rolsuper: false,
    rolbypassrls: false, rolcreatedb: false, rolcreaterole: false,
    rolreplication: false, membership: false, unexpected_ownership: false,
    public_create: false, table_write: false };
}

function harness(initialRoles = [role(E), role(O)]) {
  let committed = initialRoles.map(r => ({ ...r }));
  let pending = committed.map(r => ({ ...r }));
  const calls: { sql: string; values?: unknown[]; database: string }[] = [];
  const options: any[] = [];
  const state = { wrongDatabase: false, wrongCluster: false, wrongPrincipal: false,
    superuser: true, publicWrite: false, publicCreate: false, privateSchema: false,
    failOwnerCreate: false, failCommit: false, failPostcheck: false,
    failRollback: false, connections: 0, closed: 0, postchecks: 0 };
  const createClient = jest.fn((connection: any) => {
    options.push(connection);
    return {
      connect: jest.fn(async () => { state.connections++; }),
      end: jest.fn(async () => { state.closed++; }),
      query: jest.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values, database: connection.database });
        if (sql.includes('pg_control_system()')) return { rows: [{
          database: state.wrongDatabase ? 'wrong_database' : connection.database,
          session_user: state.wrongPrincipal ? 'sf_app' : 'isolated_admin',
          current_user: 'isolated_admin', rolsuper: state.superuser,
          system_identifier: state.wrongCluster ? '999999999' : '123456789',
        }] };
        if (sql === 'BEGIN' || sql === 'BEGIN READ ONLY') {
          if (connection.database !== 'postgres') pending = committed.map(r => ({ ...r }));
          return { rows: [] };
        }
        if (sql.includes('FROM pg_catalog.pg_roles r WHERE r.rolname IN')) return { rows: pending.map(r => ({ ...r })) };
        if (sql.includes('AS private_schema')) return { rows: [{ public_write: state.publicWrite,
          public_create: state.publicCreate, private_schema: state.privateSchema }] };
        if (sql.includes('CREATE ROLE sf_shopify_reconnect_executor')) {
          pending.push(role(E)); return { rows: [] };
        }
        if (sql.includes('CREATE ROLE sf_shopify_reconnect_owner')) {
          if (state.failOwnerCreate) throw Error(SECRET + ADMIN_SECRET + ' SQL detail');
          pending.push(role(O)); return { rows: [] };
        }
        if (sql === 'COMMIT') {
          if (state.failCommit) throw Error('COMMIT ' + SECRET);
          committed = pending.map(r => ({ ...r })); return { rows: [] };
        }
        if (sql === 'ROLLBACK') {
          pending = committed.map(r => ({ ...r }));
          if (state.failRollback) throw Error('ROLLBACK ' + SECRET);
          return { rows: [] };
        }
        // Actual 0215 assertions are invoked through their real raw SQL boundary.
        // The mock records delegation; it does NOT interpret/prove those SQL rules.
        if (sql.includes('DO $boundary$')) { state.postchecks++; return { rows: [] }; }
        if (sql.includes('DO $postconditions$')) {
          if (state.failPostcheck) throw Error('RECONNECT_FINALIZER_ACL_INVALID ' + SECRET);
          return { rows: [] };
        }
        if (sql.includes('pg_advisory_xact_lock(1068, 215)')) return { rows: [] };
        throw Error('UNEXPECTED_MOCK_QUERY');
      }),
    };
  });
  // Trusted-orchestrator seam: real independent container/network verification
  // must be supplied later. This mock only proves proof/identity matching.
  const verifyDisposableContext = jest.fn(async (target: any) => ({
    ...target, administrator: 'isolated_admin', isolated: true, disposable: true,
  }));
  return { calls, options, state, createClient, verifyDisposableContext,
    roles: () => committed.map(r => ({ ...r })) };
}

function provisioning() {
  return { ...config(), mode: 'PROVISION', context: 'disposable-ci', executorPassword: SECRET };
}

async function refused(input: any, h: ReturnType<typeof harness>, extra: any = {}) {
  await expect(run(input, { createClient: h.createClient, ...extra }))
    .rejects.toThrow(/^SHOPIFY_RECONNECT_PREREQUISITES_REJECTED$/);
}

function writes(h: ReturnType<typeof harness>) {
  return h.calls.filter(c => /\b(CREATE ROLE|ALTER ROLE|GRANT|REVOKE|SET ROLE)\b/.test(c.sql));
}

it('defaults to CHECK and cannot mutate even when executor credentials are supplied', async () => {
  const h = harness();
  const r = await run({ ...config(), executorPassword: SECRET }, { createClient: h.createClient });
  expect(r).toEqual({ mode: 'CHECK', phase: 'PRE', created: [], security: 'ROLE_PREREQUISITES_ONLY' });
  expect(h.calls.some(c => c.sql === 'BEGIN READ ONLY')).toBe(true);
  expect(writes(h)).toEqual([]);
  expect(h.state.closed).toBe(1);
});

it('refuses mutation without independent authorization before opening a connection', async () => {
  const h = harness([]);
  await refused(provisioning(), h);
  expect(h.createClient).not.toHaveBeenCalled();
  expect(writes(h)).toEqual([]);
});

it('refuses production provisioning even with a disposable verifier supplied', async () => {
  const h = harness([]);
  await refused({ ...provisioning(), context: 'production' }, h,
    { verifyDisposableContext: h.verifyDisposableContext });
  expect(h.verifyDisposableContext).not.toHaveBeenCalled();
  expect(h.createClient).not.toHaveBeenCalled();
});

it('rejects proof that does not match the explicit endpoint and cluster', async () => {
  const h = harness([]);
  await refused(provisioning(), h, { verifyDisposableContext: async () => ({
    ...config().target, host: 'another-server', administrator: 'isolated_admin',
    isolated: true, disposable: true,
  }) });
  expect(h.createClient).not.toHaveBeenCalled();
});

it('refuses wrong database identity before any writes', async () => {
  const h = harness([]); h.state.wrongDatabase = true;
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
  expect(h.state.closed).toBe(h.state.connections);
});

it('refuses wrong cluster identity before any writes', async () => {
  const h = harness([]); h.state.wrongCluster = true;
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('refuses insufficient administrative authority rather than using SET ROLE', async () => {
  const h = harness([]); h.state.superuser = false;
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('refuses a changed session principal', async () => {
  const h = harness([]); h.state.wrongPrincipal = true;
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('refuses incompatible executor attributes before creating the missing owner', async () => {
  const h = harness([{ ...role(E), rolbypassrls: true }]);
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('refuses a LOGIN owner before creating the missing executor', async () => {
  const h = harness([{ ...role(O), rolcanlogin: true }]);
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('refuses forbidden membership edges', async () => {
  const h = harness([{ ...role(E), membership: true }, role(O)]);
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('refuses unexpected role ownership', async () => {
  const h = harness([role(E), { ...role(O), unexpected_ownership: true }]);
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('refuses effective executor application-table write privileges', async () => {
  const h = harness([{ ...role(E), table_write: true }, role(O)]);
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('refuses PUBLIC-inherited write privileges even before either role exists', async () => {
  const h = harness([]); h.state.publicWrite = true;
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('refuses PUBLIC schema creation privileges before writes', async () => {
  const h = harness([]); h.state.publicCreate = true;
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(writes(h)).toEqual([]);
});

it('preserves existing credentials instead of resetting passwords', async () => {
  const h = harness();
  const result = await run(provisioning(), h);
  expect(result.created).toEqual([]);
  expect(writes(h)).toEqual([]);
  expect(h.calls.filter(c => c.sql.includes('pg_advisory_xact_lock')))
    .toEqual([{ sql: 'SELECT pg_catalog.pg_advisory_xact_lock(1068, 215)', values: undefined, database: 'postgres' }]);
});

it('creates both roles in one transaction and repeats idempotently without plaintext SQL', async () => {
  const h = harness([]);
  const first = await run(provisioning(), h);
  const second = await run({ ...provisioning(), executorPassword: SECRET + '-different' }, h);
  expect(first.created).toEqual([E, O]);
  expect(second.created).toEqual([]);
  expect(writes(h)).toHaveLength(2);
  const sql = writes(h).map(c => c.sql).join('\n');
  expect(sql).not.toContain(SECRET);
  expect(sql).toMatch(/SCRAM-SHA-256\$16384:/);
  expect(sql).toContain('NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION');
  expect(sql).toContain('sf_shopify_reconnect_owner NOLOGIN NOSUPERUSER');
  expect(h.calls.findIndex(c => c.sql === 'BEGIN'))
    .toBeLessThan(h.calls.findIndex(c => c.sql.includes('CREATE ROLE')));
  expect(h.state.closed).toBe(h.state.connections);
});

it('rolls back the first role when the second creation fails and redacts diagnostics', async () => {
  const h = harness([]); h.state.failOwnerCreate = true;
  let error: any;
  try { await run(provisioning(), h); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe('SHOPIFY_RECONNECT_PREREQUISITES_REJECTED');
  expect(error.cause).toBeUndefined();
  expect(String(error.stack)).not.toContain(SECRET);
  expect(String(error.stack)).not.toContain(ADMIN_SECRET);
  expect(h.roles()).toEqual([]);
  expect(h.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
  expect(h.state.closed).toBe(h.state.connections);
});

it('sanitizes commit failure and attempts rollback without claiming success', async () => {
  const h = harness([]); h.state.failCommit = true;
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(h.roles()).toEqual([]);
  expect(h.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
});

it('closes every owned connection even if rollback itself fails', async () => {
  const h = harness([]); h.state.failOwnerCreate = true; h.state.failRollback = true;
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(h.state.closed).toBe(h.state.connections);
});

it('has no application credential fallback or password-bearing CLI argument', async () => {
  const env = { DATABASE_URL: 'postgresql://app:secret@dev/db',
    APP_DATABASE_URL: 'postgresql://app:secret@prod/db',
    PGHOST: 'dev', PGPORT: '5432', PGDATABASE: 'dev', PGUSER: 'sf_app', PGPASSWORD: SECRET };
  const h = harness();
  await refused(fromEnvironment(env, []), h);
  expect(h.createClient).not.toHaveBeenCalled();
  expect(() => fromEnvironment(env, ['CHECK', SECRET])).toThrow('SHOPIFY_RECONNECT_PREREQUISITES_REJECTED');
});

it('requires an explicit new executor credential and does not inherit one', async () => {
  const h = harness([]);
  await refused({ ...provisioning(), executorPassword: undefined }, h,
    { verifyDisposableContext: h.verifyDisposableContext });
  expect(h.createClient).not.toHaveBeenCalled();
});

it('distinguishes PRE role validation from POST delegation to current 0215', async () => {
  const h = harness();
  expect((await run(config(), h)).security).toBe('ROLE_PREREQUISITES_ONLY');
  expect(h.state.postchecks).toBe(0);
  expect((await run({ ...config(), phase: 'POST' }, h)).security).toBe('0215_VALIDATED');
  expect(h.state.postchecks).toBe(1);
  const authoritative = h.calls.find(c => c.sql.includes('DO $postconditions$'))!.sql;
  expect(authoritative).toContain('RECONNECT_FINALIZER_ACL_INVALID');
  expect(authoritative).toContain("has_function_privilege('sf_app', f.oid, 'EXECUTE')");
  expect(authoritative).toContain('a.grantee NOT IN (f.proowner');
  expect(authoritative).toContain('RECONNECT_TRANSITION_GUARD_INVALID');
  expect(writes(h)).toEqual([]);
});

it('refuses authoritative postcondition failures without repair or leaked SQL detail', async () => {
  const h = harness(); h.state.privateSchema = true; h.state.failPostcheck = true;
  await refused(provisioning(), h, { verifyDisposableContext: h.verifyDisposableContext });
  expect(h.state.postchecks).toBe(1);
  expect(writes(h)).toEqual([]);
});
