import type { Knex } from "knex";

/**
 * MIGRATION INTEGRITY GUARD
 * ------------------------
 * Tracks checksum of executed migrations.
 * Prevents silent drift between codebase and DB.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('migration_checksums', (table) => {
    table.string('name').primary();
    table.string('checksum').notNullable();
    table.timestamp('executed_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('migration_checksums');
}