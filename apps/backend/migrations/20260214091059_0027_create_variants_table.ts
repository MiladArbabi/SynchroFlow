import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('variants', (table) => {
    table.uuid('lasyncro_variant_id').primary();

    table
      .uuid('lasyncro_product_id')
      .notNullable()
      .references('lasyncro_product_id')
      .inTable('products')
      .onDelete('CASCADE');

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('sku', 255).nullable();

    table.string('title', 255).nullable();

    /**
     * GLOBAL IDENTIFIER (EAN / UPC / GTIN / ISBN)
     * ---------------------------------------------
     * Synced from Shopify variant.barcode field at product sync time.
     * Nullable — many SMB products have no global barcode.
     *
     * Used at receive time to:
     * - Match an inbound scan to a variant without manual selection
     * - Determine receive flow branch:
     *     barcode IS NOT NULL → scan-to-match flow (no label needed pre-receive)
     *     barcode IS NULL     → manual PO line selection → generate laSyncro label on confirm
     *
     * NOT the laSyncro internal barcode — see barcode_print_jobs.barcode_value
     * for the system-generated scannable identity assigned post-receive.
     */
    table.string('barcode', 255).nullable();
    table.index(['shop_id', 'barcode']); // fast EAN lookup at receive scan time

    /**
     * PRODUCT COST INVARIANT
     * ----------------------
     * Every variant must carry a canonical cost.
     *
     * Reason:
     * - revenue_units economic snapshot requires cost
     * - NULL cost would violate NOT NULL invariant in
     *   order_revenue_units.estimated_unit_cost
     *
     * Cost must be known before reconciliation.
     */
    table.decimal('unit_cost', 12, 2).notNullable();

    table.string('status', 255).notNullable().defaultTo('active');

    table.timestamps(true, true);

    table.unique(['shop_id', 'sku']);
    table.index(['shop_id']);
  });

  // --- RLS: Enforce tenant isolation ---
  // NOTE:
  // variants does NOT have shop_id → enforce via products relation
  await knex.raw(`
    ALTER TABLE variants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE variants FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS variants_tenant_isolation_policy ON variants;
  `);

  // NOTE:
  // variants has direct shop_id → do NOT use product join
  // This avoids unnecessary subquery scans and ensures index usage
  await knex.raw(`
    CREATE POLICY variants_tenant_isolation_policy
    ON variants
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('variants');
}
