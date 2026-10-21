/**
 * GH-979 C — 0220 reconnect-security evolution: static, DB-free contracts.
 *
 * Proves source-level structure only: shipped 0217 is byte-identical; 0220's
 * evolved postconditions are 0217's plus exactly the enumerated additions; the
 * protected runner versions 0220; discovery and settlement share one
 * eligibility predicate; DOWN restores the exact 0219 discovery function first.
 * These assertions do NOT execute SQL. Real PostgreSQL certification of the
 * same contracts is separately required.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '../..');
const MIGRATIONS = path.join(ROOT, 'apps/backend/migrations');
const M0217 = path.join(MIGRATIONS, '20261019120000_0217_shopify_manual_recovery.ts');
const M0219 = path.join(MIGRATIONS, '20261021120000_0219_create_shopify_app_disconnect_attempts.ts');
const M0220 = path.join(MIGRATIONS, '20261021130000_0220_add_state_bound_shopify_reconnect_proof.ts');
const RUNNER = path.join(ROOT, 'apps/backend/src/scripts/runMigrationsWithChecksum.ts');
const REPOSITORY = path.join(ROOT, 'apps/backend/src/services/shopify/shopifyUninstallVerification.repository.ts');
const read = (file: string) => fs.readFileSync(file, 'utf8');

/** Evaluates a migration exactly as the deployment prerequisite tool does. */
function load(file: string): Record<string, any> {
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const sandbox = { exports: {} as Record<string, any> };
  vm.runInNewContext(output, sandbox, { filename: file, timeout: 1000 });
  return sandbox.exports;
}
async function statements(run: (knex: any) => Promise<void>): Promise<string[]> {
  const sql: string[] = [];
  await run({ raw: async (text: string) => { sql.push(text); return { rows: [] }; } });
  return sql;
}
/** A top-level declaration's source text, up to its own closing line. */
function block(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(start, from + 1)).toBe(-1);
  const to = source.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to + end.length);
}
/** The first dollar-quoted span delimited by tag (the definition itself). */
const between = (source: string, tag: string) => {
  const parts = source.split(tag);
  expect(parts.length).toBeGreaterThanOrEqual(3);
  return parts[1];
};

const source0217 = read(M0217);
const source0219 = read(M0219);
const source0220 = read(M0220);

it('shipped 0217 is byte-identical to its committed checksum', () => {
  expect(crypto.createHash('sha256').update(source0217).digest('hex'))
    .toBe('79f096c86fd0dc3a430890df2bc72640a12a2d7b8bab6109291dbdbbb978e318');
});

it('every copied 0217 definition is byte-identical in 0220', () => {
  const copied: [string, string][] = [
    ['const ROLE_BOUNDARY = `', '\n`;\n'],
    ['function transitionFunction(', '\n}\n'],
    ['const PRIORITY_FUNCTIONS = `', '\n`;\n'],
    ['const INTENT_EVENT_COLUMNS = ', ' as const;\n'],
    ['const INTENT_EVENT_READ_COLUMNS = ', ' as const;\n'],
    ['function outboxTriggerFunction(', '\n}\n'],
    ['const DISPATCH_BATCH = `', '\n`;\n'],
    ['const DISPATCH_CLAIM = `', '\n`;\n'],
    ['const DISPATCH_MARK = `', '\n`;\n'],
    ['const DISPATCH_FAILURE = `', '\n`;\n'],
    ['const DISPATCH_FUNCTION_SIGNATURES = ', ' as const;\n'],
    ['function finalizerDefinition(', '\n}\n'],
    ['function body(', '\n}\n'],
    ['const BILLING_POSTCONDITIONS = `', '\n`;\n'],
  ];
  for (const [start, end] of copied) {
    expect(block(source0220, start, end)).toBe(block(source0217, start, end));
  }
  // The 0216 claim and the claim ACL are 0217-owned; 0220 never re-creates them.
  expect(source0220).not.toContain('DISPATCH_CLAIM_0216');
  expect(source0220).not.toContain('const CLAIM_ACL');
});

it('the evolved dispatch authority differs from 0217 only by the three enumerated changes', () => {
  const original = block(source0217, 'async function assertDispatchAuthority(', '\n}\n');
  const evolved = block(source0220, 'async function assertEvolvedDispatchAuthority(', '\n}\n');
  const expected = original
    .replace('async function assertDispatchAuthority(knex: Knex): Promise<void> {\n  await knex.raw(ROLE_BOUNDARY);',
      'async function assertEvolvedDispatchAuthority(knex: Knex): Promise<void> {\n  await knex.raw(ROLE_BOUNDARY_0220);')
    .replace("      IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = n.oid) <> 1\n",
      "      IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = n.oid) <> 2\n"
      + "         OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace = n.oid AND oid NOT IN (\n"
      + "              COALESCE(pg_catalog.to_regprocedure('${FINALIZER_SIGNATURE}')::oid, 0),\n"
      + "              COALESCE(pg_catalog.to_regprocedure('${STATE_BOUND_FINALIZER_SIGNATURE}')::oid, 0)))\n")
    .replace("            'public.domain_events'::regclass, 'public.domain_event_outbox'::regclass)\n          AND (pg_catalog.has_table_privilege('sf_shopify_reconnect_owner'",
      "            'public.domain_events'::regclass, 'public.domain_event_outbox'::regclass,\n"
      + "            'public.shopify_reconnect_recovery_proofs'::regclass)\n"
      + "          AND (pg_catalog.has_table_privilege('sf_shopify_reconnect_owner'");
  expect(expected).not.toBe(original);
  expect(evolved).toBe(expected);
});

describe('evaluated postconditions', () => {
  const m0217 = load(M0217);
  const m0220 = load(M0220);

  it('0220 enforces every 0217 statement, changing only the role boundary and two clauses', async () => {
    const before = await statements(m0217.assertSecurityPostconditions);
    const after = await statements(m0220.assertSecurityPostconditions);
    expect(before).toHaveLength(3);
    expect(after).toHaveLength(6);
    // Role boundary: exactly one change, admitting only the named overload.
    const boundary = (await statements(m0217.up))[0];
    const legacy = m0220.LEGACY_FINALIZER_SIGNATURE;
    const overload = m0220.STATE_BOUND_FINALIZER_SIGNATURE;
    expect(after[0]).toBe(boundary.replace(
      `(proowner = o.oid AND oid <>\n                    COALESCE(pg_catalog.to_regprocedure('${legacy}')::oid, 0)))`,
      `(proowner = o.oid AND oid NOT IN (\n                    COALESCE(pg_catalog.to_regprocedure('${legacy}')::oid, 0),\n`
      + `                    COALESCE(pg_catalog.to_regprocedure('${overload}')::oid, 0))))`));
    expect(after[0]).not.toBe(boundary);
    expect(after[2]).toBe(before[2]); // billing outbox authority unchanged
    for (const guard of ['RECONNECT_FINALIZER_ACL_INVALID', 'RECONNECT_TRANSITION_GUARD_INVALID',
      'PRIORITY_FUNCTION_AUTHORITY_INVALID', 'RECONNECT_OWNER_OBJECT_ACL_INVALID',
      'RECONNECT_INTENT_AUTHORITY_INVALID', 'RECONNECT_INTENT_TRIGGER_INVALID',
      'SYNC_DISPATCH_FUNCTION_AUTHORITY_INVALID', 'RECONNECT_PRIVATE_SCHEMA_CONTENTS_INVALID']) {
      expect(after[1]).toContain(guard);
    }
  });

  it('pins the overload: O-owned definer, E-only EXECUTE, no sf_app/PUBLIC, exact body and settings', async () => {
    const sql = (await statements(m0220.assertSecurityPostconditions))[3];
    expect(sql).toContain(`to_regprocedure('${m0220.STATE_BOUND_FINALIZER_SIGNATURE}')`);
    for (const clause of ['NOT f.prosecdef OR f.proowner <> o',
      "f.pronamespace <> 'shopify_reconnect_private'::regnamespace",
      'pg_catalog.cardinality(f.proconfig) <> 3', 'f.proacl IS NULL',
      "NOT pg_catalog.has_function_privilege(e, f.oid, 'EXECUTE')",
      "pg_catalog.has_function_privilege(app, f.oid, 'EXECUTE')",
      'a.grantee NOT IN (f.proowner, e)', 'f.prosrc IS DISTINCT FROM',
      'STATE_BOUND_FINALIZER_AUTHORITY_INVALID']) {
      expect(sql).toContain(clause);
    }
  });

  it('pins the proof table: FORCE RLS, tenant policies, O column INSERT, sf_app SELECT, nothing else', async () => {
    const sql = (await statements(m0220.assertSecurityPostconditions))[3];
    for (const clause of ['c.relrowsecurity AND c.relforcerowsecurity', 'c.relowner NOT IN (o, e, app)',
      "a.grantee <> app OR a.privilege_type <> 'SELECT' OR a.is_grantable",
      "a.grantee <> o OR a.privilege_type <> 'INSERT' OR a.is_grantable",
      "ARRAY['shop_id','integration_id','installation_id','credential_generation','oauth_state_hash']",
      "pg_catalog.has_table_privilege(o, proofs, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
      "pg_catalog.has_any_column_privilege(e, proofs, 'SELECT,INSERT,UPDATE,REFERENCES')",
      'p.polroles = ARRAY[app]::oid[]', 'p.polroles = ARRAY[o]::oid[]',
      "'shopify_uninstall_verifications_select_policy'", "'shopify_uninstall_verifications_insert_policy'",
      "pg_catalog.has_sequence_privilege(app, proof_sequence, 'USAGE,SELECT,UPDATE')",
      'RECONNECT_RECOVERY_PROOF_AUTHORITY_INVALID']) {
      expect(sql).toContain(clause);
    }
  });

  it('pins the evolved discovery function to its 0219 owner, sf_app-only ACL and exact body', async () => {
    const sql = (await statements(m0220.assertSecurityPostconditions))[4];
    for (const clause of ["to_regprocedure('public.next_shopify_uninstall_recovery_shop()')",
      "to_regprocedure('public.claim_shopify_uninstall_verification()')",
      'd.proowner <> sibling_owner', 'd.proowner IN (o, e, app)', 'NOT d.prosecdef',
      "d.prorettype <> 'integer'::regtype", "ARRAY['search_path=pg_catalog, pg_temp']::text[]",
      'a.grantee NOT IN (d.proowner, app)', 'RECOVERY_DISCOVERY_AUTHORITY_INVALID']) {
      expect(sql).toContain(clause);
    }
    expect(sql).toContain('shopify_reconnect_recovery_proofs AS proof');
  });

  it('pins append-only recovery authorization security', async () => {
  const sql = (await statements(m0220.assertSecurityPostconditions))[5];
  for (const clause of [
    'shopify_uninstall_recovery_authorizations',
    'c.relrowsecurity AND c.relforcerowsecurity',
    "NOT pg_catalog.has_table_privilege(app, auths, 'SELECT')",
    "pg_catalog.has_table_privilege(app, auths, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')",
    "pg_catalog.has_any_column_privilege(app, auths, 'INSERT,UPDATE,REFERENCES')",
    "a.privilege_type <> 'SELECT'",
    'p.polroles = ARRAY[app]::oid[]',
    'p.polroles = ARRAY[0]::oid[]',
    'shopify_uninstall_recovery_auth_verification_fk',
    "col.attname = 'verification_id'",
    "col.attname = 'oauth_state_hash'",
    "col.attname = 'shop_id'",
    "col.attrelid = c.confrelid AND col.attname = 'id'",
    'c.convalidated AND NOT c.condeferrable AND NOT c.condeferred',
    "c.confdeltype = 'c' AND c.confupdtype = 'a'",
    "pg_catalog.pg_get_expr(c.conbin, c.conrelid)",
    "= '(oauth_state_hash ~ ''^[a-f0-9]{64}$''::text)'",
    `to_regprocedure('${m0220.OAUTH_ISSUANCE_SIGNATURE}')`,
    'issuer.proowner <> (SELECT c.relowner',
    "NOT pg_catalog.has_function_privilege(app, issuer.oid, 'EXECUTE')",
    "pg_catalog.has_function_privilege(o, issuer.oid, 'EXECUTE')",
    'issuer.prosrc IS DISTINCT FROM',
    'RECOVERY_AUTHORIZATION_AUTHORITY_INVALID',
  ]) {
    expect(sql).toContain(clause);
  }
});

it('0219 removes direct sf_app authorization writes and exposes only the exact controlled issuer', () => {
  expect(source0219).toContain('GRANT SELECT ON public.shopify_uninstall_recovery_authorizations TO sf_app;');
  expect(source0219).not.toMatch(/GRANT\s+SELECT\s*,\s*INSERT\s+ON\s+public\.shopify_uninstall_recovery_authorizations\s+TO\s+sf_app/i);
  expect(source0219).toContain('CREATE FUNCTION public.issue_shopify_oauth_state_with_recovery(');
  expect(source0219).toContain("session_user <> 'sf_app'");
  expect(source0219).toContain('membership.revoked_at IS NULL');
  expect(source0219).toContain("EXISTS (SELECT 1 FROM authority WHERE authority.role = 'owner')");
  expect(source0219).toContain("public.digest(pg_catalog.convert_to(p_state, 'UTF8'), 'sha256')");
  expect(source0219).toContain('FROM eligible CROSS JOIN issued\n        WHERE true\n        ON CONFLICT');
  expect(source0219).toContain('GRANT EXECUTE ON FUNCTION public.issue_shopify_oauth_state_with_recovery(');
  const repository = read(REPOSITORY);
  expect(repository).toContain('SELECT * FROM public.issue_shopify_oauth_state_with_recovery(');
  expect(repository).not.toContain('INSERT INTO public.shopify_uninstall_recovery_authorizations');
});

it('0220 pins the byte-identical 0219 issuer body and its state-derived authorization hash', () => {
  const body0219 = between(source0219, '$issue$');
  const body0220 = block(source0220, 'const OAUTH_ISSUANCE_BODY = `', '    `;\n')
    .slice('const OAUTH_ISSUANCE_BODY = `'.length, -'`;\n'.length);
  expect(body0220).toBe(body0219);
  const hash = body0219.indexOf('computed_hash :=');
  const state = body0219.indexOf('INSERT INTO public.integration_oauth_states');
  const authorization = body0219.indexOf('INSERT INTO public.shopify_uninstall_recovery_authorizations');
  expect(hash).toBeGreaterThanOrEqual(0);
  expect(state).toBeGreaterThan(hash);
  expect(authorization).toBeGreaterThan(state);
  expect(body0219).toContain('SELECT eligible.id, p_shop_id, computed_hash');
  expect(body0219).toContain('FROM eligible CROSS JOIN issued\n        WHERE true\n        ON CONFLICT');
});

it('UP verifies the 0217 pre-state first and the evolved postconditions last', async () => {
    const up = await statements(m0220.up);
    const boundary = (await statements(m0217.up))[0];
    expect(up[0]).toBe(boundary);
    expect(up[1]).toContain('CREATE TABLE public.shopify_reconnect_recovery_proofs');
    expect(up[2]).toContain('CREATE FUNCTION shopify_reconnect_private.finalize_reconnect(');
    expect(up[3]).toContain('CREATE OR REPLACE FUNCTION public.next_shopify_uninstall_recovery_shop()');
    expect(up.slice(4)).toEqual(await statements(m0220.assertSecurityPostconditions));
    const ddl = up.slice(1, 4).join('\n');
    expect(ddl).not.toMatch(/GRANT[^;]*\bTO\s+PUBLIC\b/i);
    expect(ddl).not.toMatch(/CREATE ROLE|ALTER ROLE|GRANT\s+sf_|BYPASSRLS|SECURITY DEFINER[\s\S]*OWNER TO sf_app/i);
    expect(up[2]).toContain('GRANT EXECUTE ON FUNCTION shopify_reconnect_private.finalize_reconnect(');
    expect(up[2]).toMatch(/TO sf_shopify_reconnect_executor;\s*$/);
  });

  it('DOWN restores the exact 0219 discovery function before dropping only 0220 objects', async () => {
    const down = await statements(m0220.down);
    const body0219 = between(read(M0219), '$recovery$');
    expect(down[0]).toContain(`AS $recovery$${body0219}$recovery$;`);
    expect(down[0]).toContain('GRANT EXECUTE ON FUNCTION public.next_shopify_uninstall_recovery_shop() TO sf_app;');
    expect(down[1]).toBe(`DROP FUNCTION ${m0220.STATE_BOUND_FINALIZER_SIGNATURE}`);
    expect(down[2]).toBe('DROP TABLE public.shopify_reconnect_recovery_proofs');
    expect(down[3]).toBe((await statements(m0217.up))[0]); // 0217 role contract restored
    expect(down[4]).toContain(body0219.replace(/'/g, "''"));
    expect(down.join('\n')).not.toMatch(/DROP FUNCTION public\.next_shopify|CASCADE|0217|DROP ROLE/);
  });
});

it('the state-bound wrapper validates roles and hash, delegates, then binds the tenant before the proof', () => {
  const wrapper = between(source0220, '$state_bound_finalizer$');
  const order = ["session_user <> 'sf_shopify_reconnect_executor'", "current_user <> 'sf_shopify_reconnect_owner'",
    'p_recovery_state_hash IS NULL', 'FROM shopify_reconnect_private.finalize_reconnect(',
    "pg_catalog.set_config('app.current_tenant', p_shop_id::text, true)",
    "credential.credential_state = 'ACTIVE'", 'SHOPIFY_RECONNECT_PROOF_AUTHORITY_INVALID',
    'INSERT INTO public.shopify_reconnect_recovery_proofs', 'RETURN NEXT',
    "'SHOPIFY_RECONNECT_STALE_OWNER', ERRCODE = 'PZ101'", "'SHOPIFY_RECONNECT_FINALIZATION_REJECTED'"]
    .map(fragment => wrapper.indexOf(fragment));
  expect(order.every(index => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // No credential material is stored in the proof.
  expect(wrapper).not.toMatch(/INSERT INTO public\.shopify_reconnect_recovery_proofs[^;]*token/);
});

it('the protected runner versions 0220 after 0217 without other changes to the evolution list', () => {
  const list = block(read(RUNNER), 'const SECURITY_EVOLUTIONS = [', '] as const;');
  expect(list.match(/'[^']+\.js'/g)).toEqual([
    "'20261018120000_0216_durable_shopify_sync_dispatch.js'",
    "'20261019120000_0217_shopify_manual_recovery.js'",
    "'20261021130000_0220_add_state_bound_shopify_reconnect_proof.js'",
  ]);
});

it('discovery and tenant settlement share one byte-identical eligibility predicate', () => {
  const migration = block(source0220, 'const RECOVERY_ELIGIBILITY = `', '\n`;\n');
  const repository = block(read(REPOSITORY), 'const RECOVERY_ELIGIBILITY = `', '\n`;\n');
  expect(repository).toBe(migration);
  // Live authority and proof identity, never generation or time alone.
  for (const clause of ['installation.uninstalled_at IS NULL', "credential.credential_state = 'ACTIVE'",
    "verification.outcome_code IS DISTINCT FROM 'ORDER_UNPROVEN'",
    'event.id > verification.reconnect_event_watermark_id',
    'FROM public.shopify_uninstall_recovery_authorizations AS recovery_auth',
    'recovery_auth.shop_id = verification.shop_id',
    'recovery_auth.verification_id = verification.id',
    'proof.oauth_state_hash = recovery_auth.oauth_state_hash',
    'proof.installation_id = installation.id', 'proof.integration_id = integration.id',
    'integration.platform_shop_name = verification.shop_domain']) {
    expect(migration).toContain(clause);
  }
  expect(migration).not.toMatch(/created_at|updated_at|now\(\)|observed_credential_generation/);
});

it('no generation-only recovery helper or unsafe reconciler remains', () => {
  const repository = read(REPOSITORY);
  for (const removed of ['supersedeShopifyUninstallVerifications', 'reconcileOrderedShopifyUninstallVerifications',
    'completeOrderUnprovenRecovery', 'authorizeOrderUnprovenRecovery', "whereNot('verification.outcome_code'"]) {
    expect(repository).not.toContain(removed);
  }
  const sources = ['apps/backend/src/workers/shopifyUninstallVerification.worker.ts',
    'apps/backend/src/api/integrations/integration.controller.ts'].map(file => read(path.join(ROOT, file)));
  for (const text of sources) expect(text).not.toMatch(/reconcileOrderedShopify|completeOrderUnproven|'SUPERSEDED', 'AUTHORITY_CHANGED'/);
});
