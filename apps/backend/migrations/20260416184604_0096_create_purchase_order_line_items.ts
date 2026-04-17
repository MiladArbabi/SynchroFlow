import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('purchase_order_line_items', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table
      .uuid('po_id')
      .notNullable()
      .references('id')
      .inTable('purchase_orders')
      .onDelete('CASCADE');

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .nullable() // nullable: PO may reference a product not yet in system
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('SET NULL');

    /**
     * FREE-TEXT PRODUCT DESCRIPTION
     * ------------------------------
     * Captures product details as agreed with supplier —
     * material, color, spec — independent of variant catalog.
     * Required when lasyncro_variant_id is null (product not yet in system).
     */
    table.string('description', 1024).notNullable();

    table.integer('quantity_ordered').notNullable();
    table.integer('quantity_received').notNullable().defaultTo(0);

    /**
     * UNIT COST
     * ---------
     * Stored in shop base_currency cents.
     * Never converted — display layer handles formatting.
     */
    table.integer('unit_cost_cents').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['po_id']);
    table.index(['shop_id']);
    table.index(['lasyncro_variant_id']);
  });

  await knex.raw(`
    ALTER TABLE purchase_order_line_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE purchase_order_line_items FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS purchase_order_line_items_tenant_isolation_policy ON purchase_order_line_items;
  `);

  await knex.raw(`
    CREATE POLICY purchase_order_line_items_tenant_isolation_policy
    ON purchase_order_line_items
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('purchase_order_line_items');
}