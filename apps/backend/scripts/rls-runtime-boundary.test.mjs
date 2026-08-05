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
});
