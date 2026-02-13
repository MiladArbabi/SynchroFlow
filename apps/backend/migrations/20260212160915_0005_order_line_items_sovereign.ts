import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_line_items', (table) => {
    table
      .uuid('lasyncro_line_item_id')
      .primary()

    // Sovereign order reference
    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    // Sovereign product reference
    table.uuid('lasyncro_product_id')
      .notNullable()
      .references('lasyncro_product_id')
      .inTable('products')
      .onDelete('RESTRICT');

    // Commercial attributes
    table.string('sku').nullable();
    table.string('title').notNullable();

    table.integer('quantity').notNullable();

    table.decimal('unit_price', 12, 2).notNullable();
    table.decimal('line_total', 14, 2).notNullable();

    // Cost layer (optional but critical for margin engine)
    table.decimal('estimated_unit_cost', 12, 2).nullable();

    // Platform traceability (NOT identity)
    table.string('platform').nullable();
    table.string('external_line_item_id').nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Indexes
    table.index(['lasyncro_order_id']);
    table.index(['lasyncro_product_id']);
    table.index(['sku']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_line_items');
}