import type { Knex } from 'knex';

/**
 * RECOUNT-COUNTZERO-34
 * WHY: An operator who cannot reach a bin had no way to say so. closeCount
 * rejected any line with a NULL counted_quantity, so the only way to close a
 * task was to enter 0 — and 0 passes commitRecount's guards, fabricating
 * shrinkage in inventory_movements. skip_reason resolves the line while
 * leaving counted_quantity NULL, so commit still excludes it.
 * NOT a member of recount_variance_reason: that enum answers "why did counted
 * differ from expected", which presumes a count happened.
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('inventory_recount_lines');
  if (!hasTable) {
    throw new Error('[0158] inventory_recount_lines missing — 0153 must run first');
  }

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'recount_skip_reason') THEN
        CREATE TYPE recount_skip_reason AS ENUM (
          'bin_inaccessible',
          'stock_in_motion',
          'bin_not_found',
          'other'
        );
      END IF;
    END $$;
  `);

  await knex.schema.alterTable('inventory_recount_lines', (table) => {
    table.specificType('skip_reason', 'recount_skip_reason').nullable();
    table.integer('skipped_by').nullable();
    table.timestamp('skipped_at', { useTz: true }).nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('inventory_recount_lines', (table) => {
    table.dropColumn('skipped_at');
    table.dropColumn('skipped_by');
    table.dropColumn('skip_reason');
  });
  await knex.raw(`DROP TYPE IF EXISTS recount_skip_reason;`);
}