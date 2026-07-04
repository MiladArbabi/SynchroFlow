import type { Knex } from 'knex';

/**
 * MIGRATION 0113 — WM-38 Carrier Integration
 * --------------------------------------------
 * Two new tables:
 *
 * 1. shop_carrier_settings
 *    Per-shop, per-carrier credential store.
 *    public_key + private_key are AES-256-GCM encrypted at rest
 *    via encryption.service.ts before insert.
 *    PK: (shop_id, carrier_code) — one row per carrier per shop.
 *
 * 2. order_shipment_tracking
 *    One row per physical shipment dispatched.
 *    Supports partial shipments — one order can have multiple rows.
 *    label_url: Sendcloud-hosted PDF link (primary).
 *    label_pdf: stored bytes fallback if URL unavailable.
 *    Consumed by: Outbound module tracking column,
 *    shopifyFulfillmentWriteback trackingInfo extension.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_carrier_settings', (table) => {
    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .string('carrier_code', 32)
      .notNullable();

    table.primary(['shop_id', 'carrier_code']);

    /**
     * Encrypted Sendcloud API credentials (AES-256-GCM).
     * Raw values never stored. Decrypted only inside
     * sendcloud.carrier.service.ts via 'wms.carrier.sendcloud' context.
     */
    table.text('public_key').nullable();
    table.text('private_key').nullable();
    table.text('api_token').nullable();

    table
      .boolean('is_active')
      .notNullable()
      .defaultTo(true);

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE shop_carrier_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_carrier_settings FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shop_carrier_settings_tenant_isolation_policy ON shop_carrier_settings;
    CREATE POLICY shop_carrier_settings_tenant_isolation_policy
    ON shop_carrier_settings
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);

  await knex.schema.createTable('order_shipment_tracking', (table) => {
    table
      .uuid('id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table
      .uuid('pick_batch_id')
      .nullable()
      .references('pick_batch_id')
      .inTable('pick_batches')
      .onDelete('SET NULL');

    table.string('carrier_code', 32).notNullable();
    table.string('tracking_number', 255).nullable();
    table.text('tracking_url').nullable();

    /**
     * label_url: Sendcloud-hosted PDF (primary — fetch with merchant credentials).
     * label_pdf: stored bytes fallback (populated if URL-based fetch fails at print time).
     */
    table.text('label_url').nullable();
    table.binary('label_pdf').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['shop_id', 'lasyncro_order_id']);
  });

  await knex.raw(`
    ALTER TABLE order_shipment_tracking ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_shipment_tracking FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS order_shipment_tracking_tenant_isolation_policy ON order_shipment_tracking;
    CREATE POLICY order_shipment_tracking_tenant_isolation_policy
    ON order_shipment_tracking
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_shipment_tracking');
  await knex.schema.dropTableIfExists('shop_carrier_settings');
}
