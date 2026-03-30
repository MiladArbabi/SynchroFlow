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
  
    /**
     * VARIANT IDENTITY
     * ----------------
     * Required for deterministic revenue-unit creation.
     *
     * IMPORTANT:
     * FK constraint is intentionally NOT enforced here
     * because the variants table is created later in
     * migration sequence (0027).
     *
     * Referential integrity is enforced upstream
     * during product ingestion and reconciliation.
     */
    table.uuid('lasyncro_variant_id').notNullable();

    // Commercial attributes
    table.string('sku').nullable();
    table.string('title').notNullable();

    table.integer('quantity').notNullable();

    table.decimal('unit_price', 12, 2).notNullable();
    table.decimal('line_total', 14, 2).notNullable();

    // Platform traceability (NOT identity)
    table.string('platform').nullable();
    table.string('external_line_item_id').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable();
    table.timestamp('updated_at', { useTz: true }).notNullable();

    // Indexes
    table.index(['lasyncro_order_id']);
    /**
     * Reconciliation lookup index
     * Ensures deterministic ordering for revenue-unit creation
     */
    table.index(['lasyncro_variant_id']);
    table.index(['lasyncro_product_id']);
    table.index(['sku']);
  });

  // --- RLS: Enforce tenant isolation ---
  await knex.raw(`
    ALTER TABLE order_line_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_line_items FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_line_items_tenant_isolation_policy ON order_line_items;
  `);

  // NOTE:
  // order_line_items does NOT have shop_id.
  // Tenant isolation enforced via parent orders table.
  // This ensures correct multi-tenant boundary enforcement.
  await knex.raw(`
    CREATE POLICY order_line_items_tenant_isolation_policy
    ON order_line_items
    USING (
      lasyncro_order_id IN (
        SELECT lasyncro_order_id
        FROM orders
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  // NOTE:
  // Required for strict tenant isolation across all dependent order data.
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_line_items');
}