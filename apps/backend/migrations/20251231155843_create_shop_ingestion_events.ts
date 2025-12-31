import { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.schema.createTable('shop_ingestion_events', table => {
    table.increments('id').primary();
    table.integer('shop_id').notNullable().index();
    table.string('module_id').notNullable();
    table.string('event').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.unique(['shop_id', 'module_id', 'event']);
  });
}

export async function down(knex: Knex) {
  await knex.schema.dropTable('shop_ingestion_events');
}
