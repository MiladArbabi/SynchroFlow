import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('external_order_identity_map', (table) => {
    table.increments('id').primary();

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('platform').notNullable(); // shopify, amazon, woocommerce, etc.
    table.string('external_order_id').notNullable();

    table.timestamps(true, true);

    table.unique(['shop_id', 'platform', 'external_order_id']);
    table.index(['lasyncro_order_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('external_order_identity_map');
}