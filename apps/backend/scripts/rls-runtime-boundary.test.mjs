import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listTypeScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [absolutePath] : [];
  });
}

test('production runtime uses and verifies the restricted connection', () => {
  const config = read('packages/backend-core/src/config/database.config.ts');
  const db = read('packages/backend-core/src/db.ts');

  assert.match(config, /process\.env\.APP_DATABASE_URL/);
  assert.match(
    config,
    /DATABASE_URL is reserved for the release-command migration runner/
  );
  assert.match(db, /identity\.current_user !== 'sf_app'/);
  assert.match(db, /identity\.rolsuper !== false/);
  assert.match(db, /identity\.rolbypassrls !== false/);
});

test('raw and single-string runtime queries are not auto-bypassed', () => {
  const db = read('packages/backend-core/src/db.ts');

  assert.doesNotMatch(db, /argumentsList\.length\s*===\s*1/);
  assert.doesNotMatch(
    db,
    /typeof argumentsList\[0\]\s*===\s*['"]string['"]/
  );
  assert.match(db, /TENANT_CONTEXT_MISSING/);
  assert.match(db, /getTenantContextShopId\(\)/);
  assert.match(db, /queryBuilder\.transacting\(trx\)/);
  assert.match(db, /if \(property === 'transaction'\)/);
  assert.match(db, /if \(property === 'raw'\)/);
  assert.match(db, /guardTenantQuery\(target, \(target\.raw as any\)/);
});

test('privileged database client is absent from runtime source', () => {
  const runtimeFiles = listTypeScriptFiles(
    path.join(root, 'apps/backend/src')
  ).filter(
    (file) =>
      !file.includes(`${path.sep}cli${path.sep}`) &&
      !file.includes(`${path.sep}scripts${path.sep}`)
  );

  const offenders = runtimeFiles
    .filter((file) => fs.readFileSync(file, 'utf8').includes('/system-db.js'))
    .map((file) => path.relative(root, file));

  assert.deepEqual(offenders, []);
});

test('forward migration repairs every production RLS finding', () => {
  const migration = read(
    'apps/backend/migrations/20260805120000_0137_enforce_runtime_rls_boundary.ts'
  );
  const forceTables = [
    'alerts',
    'daily_operational_brief_snapshot',
    'decisions',
    'expansion_eligibility_state',
    'fulfillment_executions',
    'lifecycle_events',
    'order_constraints',
    'orders_operational_control_snapshot',
    'pack_decision_requests',
    'reorder_requests',
    'shop_operational_settings',
    'shop_snapshot_jobs',
    'shopify_products',
    'supplier_product_preferences',
    'system_readiness_state',
  ];

  for (const table of forceTables) {
    assert.match(migration, new RegExp(`'${table}'`));
  }

  for (const table of [
    'domain_events',
    'integrations',
    'shopify_app_installations',
  ]) {
    assert.match(migration, new RegExp(`CREATE POLICY ${table}_select_policy`));
    assert.match(migration, new RegExp(`CREATE POLICY ${table}_write_policy`));
  }

  assert.match(migration, /current_setting\('app\.current_tenant', true\)/);
  assert.match(migration, /SET SCHEMA lasyncro_archive/);
});

test('release command contains schema and invalid-tenant gates', () => {
  const runner = read(
    'apps/backend/src/scripts/runMigrationsWithChecksum.ts'
  );

  assert.match(runner, /enabled_not_forced/);
  assert.match(runner, /shop_id_without_rls/);
  assert.match(runner, /rls_without_policy/);
  assert.match(runner, /SET LOCAL ROLE sf_app/);
  assert.match(runner, /'2147483647'/);
  assert.match(runner, /sf_app invalid-tenant visibility/);
  assert.match(runner, /sf_app tenant-zero visibility/);
  assert.match(runner, /sf_app missing-tenant visibility/);
  assert.match(runner, /unsafePolicies/);
  assert.match(runner, /tenantZeroTables: tenantTables\.length/);
});

test('0138 removes tenant-zero policies and exposes only narrow resolvers', () => {
  const migration = read(
    'apps/backend/migrations/20260805200000_0138_close_tenant_zero_rls_paths.ts'
  );

  for (const table of [
    'users',
    'refresh_tokens',
    'shop_memberships',
    'shop_subscriptions',
    'shop_module_entitlements',
    'commands',
    'decision_execution_queue',
    'order_reconciliation_intents',
    'user_lifecycle_snapshot',
    'shop_carrier_webhook_tokens',
  ]) {
    assert.match(migration, new RegExp(`table: '${table}'`));
  }

  assert.match(migration, /DROP POLICY IF EXISTS shops_insert_open ON shops/);
  assert.match(migration, /CREATE POLICY shops_tenant_isolation_policy/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.create_tenant_shop/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.resolve_auth_user_by_email/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.resolve_refresh_token/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.revoke_refresh_token/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.list_pending_commands/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.resolve_carrier_webhook_token/);
  assert.doesNotMatch(migration, /WITH CHECK \(true\)/);
});

test('0139 strictly tenant-scopes activation audit events', () => {
  const migration = read(
    'apps/backend/migrations/20260805210000_0139_enforce_activation_audit_tenant_scope.ts'
  );

  assert.match(migration, /\[0139_NULL_SHOP_ROWS\]/);

  assert.match(
    migration,
    /ALTER TABLE activation_audit_events[\s\S]*ALTER COLUMN shop_id SET NOT NULL;/
  );

  assert.match(
    migration,
    /DROP POLICY IF EXISTS\s+activation_audit_events_tenant_isolation_policy\s+ON activation_audit_events;/
  );

  assert.match(
    migration,
    /CREATE POLICY activation_audit_events_tenant_isolation_policy[\s\S]*FOR ALL/
  );

  assert.match(
    migration,
    /USING\s*\(\s*shop_id\s*=\s*NULLIF\([\s\S]*current_setting\('app\.current_tenant', true\)[\s\S]*\)::integer\s*\)/
  );

  assert.match(
    migration,
    /WITH CHECK\s*\(\s*shop_id\s*=\s*NULLIF\([\s\S]*current_setting\('app\.current_tenant', true\)[\s\S]*\)::integer\s*\)/
  );

  const policySql = migration.match(
    /CREATE POLICY activation_audit_events_tenant_isolation_policy[\s\S]*?;/
  );

  assert.ok(policySql);
  assert.doesNotMatch(policySql[0], /\bshop_id\s+IS\s+NULL\b/i);
  assert.match(migration, /\[0139_DOWN_UNSUPPORTED\]/);
});

test('runtime call sites do not query repaired pre-tenant tables directly', () => {
  const auth = read('apps/backend/src/api/auth/auth.controller.ts');
  const memberships = read(
    'packages/backend-core/src/services/shop-resolution.service.ts'
  );
  const commands = read('apps/backend/src/workers/commands.consumer.ts');
  const executions = read(
    'apps/backend/src/workers/execution.dispatcher.worker.ts'
  );

  assert.doesNotMatch(auth, /systemQuery\([\s\S]{0,120}db(?:<[^>]+>)?\('users'\)/);
  assert.doesNotMatch(auth, /systemQuery\([\s\S]{0,120}db\('refresh_tokens'\)/);
  assert.doesNotMatch(memberships, /db\('shop_memberships'\)/);
  assert.doesNotMatch(commands, /systemQuery\(/);
  assert.doesNotMatch(executions, /systemQuery\(/);
});

test('production runtime rejects privileged migration credentials', () => {
  const db = read('packages/backend-core/src/db.ts');
  const fly = read('fly.toml');

  assert.match(db, /FATAL_PRIVILEGED_DATABASE_CREDENTIAL_PRESENT/);
  assert.doesNotMatch(fly, /release_command/);
});
