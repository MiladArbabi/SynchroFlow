import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('external_product_identity_map', (table) => {
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .uuid('lasyncro_product_id')
      .notNullable()
      .references('lasyncro_product_id')
      .inTable('products')
      .onDelete('CASCADE');

    table.integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('platform').notNullable();              // shopify, amazon, woo
    table.string('external_product_id').notNullable();  // platform product id
    table.string('external_variant_id');                // optional variant id
    table.string('external_sku');                       // raw platform SKU

    table.timestamp('created_at', { useTz: true })
         .notNullable()
         .defaultTo(knex.fn.now());

    table.unique([
      'shop_id',
      'platform',
      'external_product_id',
      'external_variant_id'
    ], 'external_product_identity_unique');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('external_product_identity_map');
}