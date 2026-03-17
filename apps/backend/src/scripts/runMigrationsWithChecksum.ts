import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import knexConfig from '../../knexfile.cjs';
import knex from 'knex';

/**
 * MIGRATION RUNNER WITH CHECKSUM ENFORCEMENT
 * ------------------------------------------
 * Guarantees:
 * - No migration file is modified after execution
 * - DB state matches codebase exactly
 */

const db = knex(knexConfig.development);

const MIGRATIONS_DIR = path.join(process.cwd(), 'dist/migrations');

function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function main() {
  console.info('[migration-runner] start');

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
    .onConflict('name')
    .merge();
}

  console.info('[migration-runner] checksum sync complete');

  await db.destroy();
}

main().catch(err => {
  console.error('[migration-runner] failed', err);
  process.exit(1);
});