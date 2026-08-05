import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const knexConfig = (await import(
  path.resolve(__dirname, '../../../knexfile.cjs')
)).default;

import knex from 'knex';
import { execSync } from 'child_process';

/**
 * MIGRATION RUNNER WITH CHECKSUM ENFORCEMENT
 * ------------------------------------------
 * Guarantees:
 * - No migration file is modified after execution
 * - DB state matches codebase exactly
 */

const env = process.env.NODE_ENV || 'development';
const db = knex(knexConfig[env]);

// Resolve dist/migrations relative to compiled script location (context-independent)
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

console.info('[migration-runner] resolved MIGRATIONS_DIR=', MIGRATIONS_DIR);

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function assertProductionRlsBoundary(): Promise<void> {
  const roleResult = await db.raw(`
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname = 'sf_app'
  `);
  const appRole = roleResult.rows[0];

  if (
    !appRole ||
    appRole.rolsuper !== false ||
    appRole.rolbypassrls !== false
  ) {
    throw new Error(
      `[RLS_RELEASE_GATE_FAILED] sf_app must be NOSUPERUSER/NOBYPASSRLS: ${JSON.stringify(appRole ?? null)}`
    );
  }

  const invariantResult = await db.raw(`
    SELECT
      ARRAY_AGG(c.relname ORDER BY c.relname) FILTER (
        WHERE c.relrowsecurity AND NOT c.relforcerowsecurity
      ) AS enabled_not_forced,
      ARRAY_AGG(c.relname ORDER BY c.relname) FILTER (
        WHERE NOT c.relrowsecurity
          AND EXISTS (
            SELECT 1
            FROM pg_attribute a
            WHERE a.attrelid = c.oid
              AND a.attname = 'shop_id'
              AND a.attnum > 0
              AND NOT a.attisdropped
          )
      ) AS shop_id_without_rls,
      ARRAY_AGG(c.relname ORDER BY c.relname) FILTER (
        WHERE c.relrowsecurity
          AND NOT EXISTS (
            SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
          )
      ) AS rls_without_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
  `);

  const invariants = invariantResult.rows[0];
  const violations = {
    enabledNotForced: invariants.enabled_not_forced ?? [],
    shopIdWithoutRls: invariants.shop_id_without_rls ?? [],
    rlsWithoutPolicy: invariants.rls_without_policy ?? [],
  };

  if (Object.values(violations).some((tables) => tables.length > 0)) {
    throw new Error(
      `[RLS_RELEASE_GATE_FAILED] schema invariants: ${JSON.stringify(violations)}`
    );
  }

  const tenantTablesResult = await db.raw(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity
      AND EXISTS (
        SELECT 1
        FROM pg_attribute a
        WHERE a.attrelid = c.oid
          AND a.attname = 'shop_id'
          AND a.attnum > 0
          AND NOT a.attisdropped
      )
    ORDER BY c.relname
  `);

  const tenantTables: Array<{ table_name: string }> = tenantTablesResult.rows;
  const visibleTables: string[] = [];
  const visibleAtZero: string[] = [];

  await db.transaction(async (trx) => {
    await trx.raw('SET LOCAL ROLE sf_app');
    await trx.raw(
      `SELECT set_config('app.current_tenant', '2147483647', true)`
    );

    const identityResult = await trx.raw(`
      SELECT current_user,
             current_setting('app.current_tenant', true) AS current_tenant
    `);
    const identity = identityResult.rows[0];

    if (
      identity.current_user !== 'sf_app' ||
      identity.current_tenant !== '2147483647'
    ) {
      throw new Error(
        `[RLS_RELEASE_GATE_FAILED] invalid probe identity: ${JSON.stringify(identity)}`
      );
    }

    for (const { table_name: tableName } of tenantTables) {
      const result = await trx.raw(`
        SELECT EXISTS (
          SELECT 1
          FROM public.${quoteIdentifier(tableName)}
          LIMIT 1
        ) AS visible
      `);

      if (result.rows[0]?.visible === true) {
        visibleTables.push(tableName);
      }
    }

    if (visibleTables.length > 0) {
      throw new Error(
        `[RLS_RELEASE_GATE_FAILED] sf_app invalid-tenant visibility: ${JSON.stringify(visibleTables)}`
      );
    }

    await trx.raw(`SELECT set_config('app.current_tenant', '0', true)`);
    for (const tableName of [
      'domain_events',
      'integrations',
      'shopify_app_installations',
    ]) {
      const result = await trx.raw(`
        SELECT EXISTS (
          SELECT 1
          FROM public.${quoteIdentifier(tableName)}
          LIMIT 1
        ) AS visible
      `);
      if (result.rows[0]?.visible === true) visibleAtZero.push(tableName);
    }

    if (visibleAtZero.length > 0) {
      throw new Error(
        `[RLS_RELEASE_GATE_FAILED] sf_app tenant-zero visibility: ${JSON.stringify(visibleAtZero)}`
      );
    }
  });

  console.info('[migration-runner] RLS release gate passed', {
    appRole,
    testedTenant: 2147483647,
    testedTables: tenantTables.length,
    tenantZeroTables: 3,
  });
}

async function main() {
  console.info('[migration-runner] start');

  /**
   * RLS ENFORCEMENT (NON-BYPASSABLE)
   * --------------------------------
   * MUST run before any migration or DB state interaction.
   * Prevents schema drift without RLS guarantees.
   */
  try {
    console.info('[migration-runner] running RLS check...');
    
    // Resolve relative to this script (same strategy as migrations)
    const rlsScriptPath = path.resolve(__dirname, '../../../scripts/check_rls.sh');

    console.info('[migration-runner] resolved RLS script path=', rlsScriptPath);

    if (!fs.existsSync(rlsScriptPath)) {
      console.error('[migration-runner] RLS script not found at:', rlsScriptPath);
      process.exit(1);
    }

    execSync(`bash ${rlsScriptPath}`, { stdio: 'inherit' });
  } catch (err) {
    console.error('[migration-runner] RLS CHECK FAILED — aborting');
    process.exit(1);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.js'));

  // Ensure table exists
  const hasTable = await db.schema.hasTable('migration_checksums');
  if (!hasTable) {
    console.warn('[migration-runner] checksum table missing, running migrations first');
    await db.migrate.latest();
  }

  // Validate existing migrations
  for (const file of files) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const checksum = hashFile(filePath);

    const existing = await db('migration_checksums')
      .where({ name: file })
      .first();

    if (existing && existing.checksum !== checksum) {
      throw new Error(
        `[MIGRATION_DRIFT_DETECTED] ${file} has been modified after execution`
      );
    }
  }

// Run migrations
const [batchNo, log] = await db.migrate.latest();

console.info('[migration-runner] applied', { batchNo, log });

/**
 * SOURCE OF TRUTH: applied migrations (DB)
 */
const appliedMigrations = await db('knex_migrations')
  .select('name')
  .orderBy('id');

/**
 * CHECKSUM SYNC (FULL)
 * --------------------
 * Ensure ALL migrations (past + new) are tracked.
 */
for (const { name: file } of appliedMigrations) {
  const filePath = path.join(MIGRATIONS_DIR, file);
  const checksum = hashFile(filePath);

  await db('migration_checksums')
    .insert({ name: file, checksum })
    // CONFLICT POLICY:
    // - Type: MIGRATION_CHECKSUM_REGISTRATION
    // - Strategy: UPSERT_EXPLICIT
    // - Rationale: ensure checksum consistency and prevent silent migration drift
    .onConflict('name')
    .merge({
      // EXPLICIT MERGE POLICY: migration checksum must be deterministic per migration name
      checksum: checksum,
      /**
       * DO NOT set executed_at in migrations.
       * -------------------------------------
       * executed_at represents runtime execution lifecycle,
       * NOT schema or migration events.
       */
    });
}

  console.info('[migration-runner] checksum sync complete');

  await assertProductionRlsBoundary();

  await db.destroy();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[migration-runner] failed', err);
    process.exit(1);
  });
