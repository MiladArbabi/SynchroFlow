import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE order_revenue_units
    ALTER COLUMN lasyncro_variant_id SET NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE order_revenue_units
    ALTER COLUMN lasyncro_variant_id DROP NOT NULL;
  `);
}
