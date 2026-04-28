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

const db = knex(knexConfig.development);

// Resolve dist/migrations relative to compiled script location (context-independent)
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

console.info('[migration-runner] resolved MIGRATIONS_DIR=', MIGRATIONS_DIR);

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
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

  await db.destroy();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[migration-runner] failed', err);
    process.exit(1);
  });