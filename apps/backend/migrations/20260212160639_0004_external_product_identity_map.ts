import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('external_product_identity_map', (table) => {
    table
      .uuid('id')
      .primary()

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
    table.string('external_inventory_item_id');        // platform inventory item id (required for inventory webhook reconciliation)
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

    table.unique([
      'shop_id',
      'platform',
      'external_inventory_item_id'
    ], 'external_inventory_item_unique');
  });

  // --- RLS: Enforce tenant isolation (direct) ---
  // shop_id is NOT NULL → authoritative tenant anchor
  await knex.raw(`
    ALTER TABLE external_product_identity_map ENABLE ROW LEVEL SECURITY;
    ALTER TABLE external_product_identity_map FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS external_product_identity_map_tenant_isolation_policy ON external_product_identity_map;
  `);

  await knex.raw(`
    CREATE POLICY external_product_identity_map_tenant_isolation_policy
    ON external_product_identity_map
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  /**
   * NOTE:
   * Direct enforcement via shop_id
   * Aligns with global invariant: IF shop_id exists → MUST be used
   */
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('external_product_identity_map');
}