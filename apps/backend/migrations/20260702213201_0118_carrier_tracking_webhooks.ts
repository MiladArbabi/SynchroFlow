// apps/backend/migrations/20260702213201_0118_carrier_tracking_webhooks.ts
// WM-40 — Carrier Tracking Webhooks
//
// Adds:
//  1. parcel_tracking_events — append-only audit trail of every carrier scan
//  2. Denormalized "current state" columns on order_shipment_tracking,
//     read on every Outbound page load (avoids window-function query
//     over event history per row)
//  3. carrier_status_map — translates carrier-specific raw status strings
//     into LaSyncro's six canonical event_type values, per carrier
//  4. webhook_secret on shop_carrier_settings — HMAC verification key
//     for inbound Sendcloud webhook signature checks

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('parcel_tracking_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable().references('id').inTable('shops');
    table
      .uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');
    table
      .uuid('shipment_tracking_id')
      .notNullable()
      .references('id')
      .inTable('order_shipment_tracking')
      .onDelete('CASCADE');
    table.string('carrier_code', 32).notNullable();
    table
      .string('event_type', 64)
      .notNullable()
      .checkIn([
        'announced',
        'in_transit',
        'out_for_delivery',
        'delivered',
        'exception',
        'returned',
      ]);
    table.string('raw_status', 128).notNullable();
    table.timestamp('event_timestamp', { useTz: true }).notNullable();
    table.text('location').nullable();
    table.jsonb('raw_payload').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Idempotency — Sendcloud may redeliver the same webhook
    table.unique(['shipment_tracking_id', 'event_type', 'event_timestamp']);
    table.index(['shop_id', 'lasyncro_order_id']);
    table.index(['shipment_tracking_id', 'event_timestamp']);
  });

  await knex.raw(`
    ALTER TABLE parcel_tracking_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE parcel_tracking_events FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS parcel_tracking_events_tenant_isolation_policy ON parcel_tracking_events;
  `);

  await knex.raw(`
    CREATE POLICY parcel_tracking_events_tenant_isolation_policy
    ON parcel_tracking_events
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);

  await knex.schema.alterTable('order_shipment_tracking', (table) => {
    table.string('latest_status', 64).nullable();
    table.text('latest_location').nullable();
    table.timestamp('latest_event_at', { useTz: true }).nullable();
    table.boolean('is_stalled').notNullable().defaultTo(false);
  });

  // @rls-exempt — shared reference data (carrier raw-status → canonical
  // event_type mapping), same category as exchange_rates. No shop_id;
  // identical across all tenants.
  await knex.schema.createTable('carrier_status_map', (table) => {
    table.increments('id').primary();
    table.string('carrier_code', 32).notNullable();
    table.string('raw_status', 128).notNullable();
    table
      .string('event_type', 64)
      .notNullable()
      .checkIn([
        'announced',
        'in_transit',
        'out_for_delivery',
        'delivered',
        'exception',
        'returned',
      ]);
    table.unique(['carrier_code', 'raw_status']);
  });

  // Seed Sendcloud's known status codes → canonical event_type
  await knex('carrier_status_map').insert([
    { carrier_code: 'sendcloud', raw_status: 'announced', event_type: 'announced' },
    { carrier_code: 'sendcloud', raw_status: 'en_route_to_sorting_center', event_type: 'in_transit' },
    { carrier_code: 'sendcloud', raw_status: 'sorted', event_type: 'in_transit' },
    { carrier_code: 'sendcloud', raw_status: 'en_route', event_type: 'in_transit' },
    { carrier_code: 'sendcloud', raw_status: 'out_for_delivery', event_type: 'out_for_delivery' },
    { carrier_code: 'sendcloud', raw_status: 'delivered', event_type: 'delivered' },
    { carrier_code: 'sendcloud', raw_status: 'delivery_attempt_failed', event_type: 'exception' },
    { carrier_code: 'sendcloud', raw_status: 'unable_to_deliver', event_type: 'exception' },
    { carrier_code: 'sendcloud', raw_status: 'damaged', event_type: 'exception' },
    { carrier_code: 'sendcloud', raw_status: 'lost', event_type: 'exception' },
    { carrier_code: 'sendcloud', raw_status: 'returned_to_sender', event_type: 'returned' },
    { carrier_code: 'sendcloud', raw_status: 'returned', event_type: 'returned' },
    { carrier_code: 'shippo', raw_status: 'PRE_TRANSIT', event_type: 'announced' },
    { carrier_code: 'shippo', raw_status: 'TRANSIT', event_type: 'in_transit' },
    { carrier_code: 'shippo', raw_status: 'DELIVERED', event_type: 'delivered' },
    { carrier_code: 'shippo', raw_status: 'FAILURE', event_type: 'exception' },
    { carrier_code: 'shippo', raw_status: 'RETURNED', event_type: 'returned' },
  ]);

  await knex.schema.alterTable('shop_carrier_settings', (table) => {
    table.text('webhook_secret').nullable(); // AES-256-GCM encrypted, same as public/private key
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_carrier_settings', (table) => {
    table.dropColumn('webhook_secret');
  });
  await knex.schema.dropTableIfExists('carrier_status_map');
  await knex.schema.alterTable('order_shipment_tracking', (table) => {
    table.dropColumn('latest_status');
    table.dropColumn('latest_location');
    table.dropColumn('latest_event_at');
    table.dropColumn('is_stalled');
  });
  await knex.schema.dropTableIfExists('parcel_tracking_events');
}