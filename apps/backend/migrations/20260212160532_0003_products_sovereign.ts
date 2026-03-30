import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('products', (table) => {
    table
      .uuid('lasyncro_product_id')
      .primary()

    table.integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    // Stable commercial identity
    table.string('sku').nullable();

    table.string('title').nullable();
    table.string('status').notNullable().defaultTo('active');

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // SKU must be unique per shop
    table.unique(['shop_id', 'sku']);
    table.index(['shop_id']);
  });

  // --- RLS: Enforce tenant isolation ---
  await knex.raw(`
    ALTER TABLE products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE products FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS products_tenant_isolation_policy ON products;
  `);

  await knex.raw(`
    CREATE POLICY products_tenant_isolation_policy
    ON products
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('products');
}