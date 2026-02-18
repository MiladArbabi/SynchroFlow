export async function up(knex) {
    await knex.schema.createTable('order_revenue_units', (table) => {
        // Sovereign identity
        table
            .uuid('lasyncro_revenue_unit_id')
            .primary();
        // Ownership
        table.uuid('lasyncro_order_id')
            .notNullable()
            .references('lasyncro_order_id')
            .inTable('orders')
            .onDelete('CASCADE');
        table.uuid('lasyncro_product_id')
            .notNullable()
            .references('lasyncro_product_id')
            .inTable('products')
            .onDelete('RESTRICT');
        // Snapshot identity (do NOT rely only on product table)
        table.string('sku', 255).nullable();
        table.string('title', 255).notNullable();
        // Financial primitives (immutable)
        table.integer('quantity').notNullable();
        table.decimal('unit_price', 12, 2).notNullable();
        table.decimal('line_total', 14, 2).notNullable();
        table.decimal('estimated_unit_cost', 12, 2).nullable();
        // Returns / refund tracking
        table.integer('returned_quantity')
            .notNullable()
            .defaultTo(0);
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
    // Enforce returned_quantity <= quantity
    await knex.raw(`
    ALTER TABLE order_revenue_units
    ADD CONSTRAINT order_revenue_units_returned_quantity_check
    CHECK (returned_quantity >= 0 AND returned_quantity <= quantity);
  `);
}
export async function down(knex) {
    await knex.schema.dropTableIfExists('order_revenue_units');
}
//# sourceMappingURL=20260212162408_0007_order_revenue_units_sovereign.js.map