import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE printer_role ADD VALUE IF NOT EXISTS 'product_label'`);
  await knex.raw(`COMMIT`);
  await knex.raw(`BEGIN`);

  await knex.schema.alterTable('variants', (table) => {
    table.string('lasyncro_barcode', 20).nullable().unique();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('variants', (table) => {
    table.dropColumn('lasyncro_barcode');
  });
}