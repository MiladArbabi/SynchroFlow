import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('receive_job_lines', (table) => {
    table.integer('quantity_sellable_provisional').nullable();
    table.timestamp('reconciliation_started_at').nullable();
  });

  await knex.raw(`
    ALTER TABLE receive_job_lines
    ADD CONSTRAINT receive_job_lines_quantity_sellable_provisional_nonnegative
    CHECK (quantity_sellable_provisional IS NULL OR quantity_sellable_provisional >= 0)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE receive_job_lines
    DROP CONSTRAINT IF EXISTS receive_job_lines_quantity_sellable_provisional_nonnegative
  `);

  await knex.schema.alterTable('receive_job_lines', (table) => {
    table.dropColumn('reconciliation_started_at');
    table.dropColumn('quantity_sellable_provisional');
  });
}
