import type { Knex } from 'knex';

/**
 * MIGRATION 0162 — explicit multi-location recount scope
 *
 * RECOUNT-CTA-33b.
 *
 * `location` remains the existing single-location scope.
 * `suggested` remains the system-derived scope.
 * `locations` represents one recount task created from an explicit set of
 * merchant-selected warehouse locations.
 *
 * PostgreSQL enum additions must commit before application code may use the
 * new value, so this migration intentionally runs outside a transaction.
 */
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE recount_task_scope
    ADD VALUE IF NOT EXISTS 'locations'
  `);
}

export async function down(_knex: Knex): Promise<void> {
  // PostgreSQL enum values cannot be removed safely in-place.
  // Keep `locations` available on rollback rather than rebuilding a live enum
  // and risking dependent-column/data corruption.
}
