import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // PO status enum
  await knex.schema.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'purchase_order_status'
      ) THEN
        CREATE TYPE purchase_order_status AS ENUM (
          'draft',
          'ordered',
          'confirmed',
          'in_production',
          'shipped',
          'partially_received',
          'received',
          'cancelled'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('purchase_orders', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .integer('supplier_id')
      .notNullable()
      .references('id')
      .inTable('suppliers')
      .onDelete('RESTRICT'); // never silently delete a supplier with open POs

    table
      .specificType('status', 'purchase_order_status')
      .notNullable()
      .defaultTo('draft');

    table.date('expected_delivery_date').nullable();
    table.date('actual_delivery_date').nullable();

    /**
     * DOCUMENT REFERENCE
     * -------------------
     * Optional path/URL to an uploaded PO document (PDF/image).
     * Supports physical POs scanned and uploaded, or email attachments.
     * AI extraction of line items planned for future sprint.
     */
    table.string('document_url', 1024).nullable();

    table.text('receive_notes').nullable()
      .comment('Notes recorded during the receive flow — per shipment comments.');

    table
      .uuid('parent_po_id')
      .nullable()
      .references('id')
      .inTable('purchase_orders')
      .onDelete('SET NULL')
      .comment('Reference to parent PO for split shipments. Unused in v1 — future sprint.');

    table.text('notes').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['shop_id', 'supplier_id']);
    table.index(['shop_id', 'status']);
  });

  await knex.raw(`
    ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS purchase_orders_tenant_isolation_policy ON purchase_orders;
  `);

  await knex.raw(`
    CREATE POLICY purchase_orders_tenant_isolation_policy
    ON purchase_orders
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('purchase_orders');
  await knex.schema.raw(`DROP TYPE IF EXISTS purchase_order_status;`);
}