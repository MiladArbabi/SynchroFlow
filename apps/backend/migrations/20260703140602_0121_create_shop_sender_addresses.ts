// Migration 0121 — shop_sender_addresses
//
// Stores the shop's own "ship from" postal address(es). Required by
// carriers whose API needs an explicit sender address in the label
// request body (Shippo). Sendcloud currently infers this from the
// merchant's own Sendcloud account configuration and does not
// consume this table yet — see note in shippo.carrier.service.ts.
//
// Table has its own primary key (not a single row per shop) because
// warehouse_locations (migration 0048) already models shops having
// multiple named physical warehouses — a sender-address table
// shouldn't assume single-warehouse when the rest of the schema
// doesn't.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_sender_addresses', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');

    table.string('name', 255).notNullable();
    table.string('street1', 255).notNullable();
    table.string('street2', 255).nullable();
    table.string('city', 100).notNullable();
    table.string('state', 100).nullable();
    table.string('postal_code', 20).notNullable();
    table.string('country_code', 2).notNullable();
    table.string('phone', 50).notNullable();
    table.string('email', 255).nullable();

    table.boolean('is_default').notNullable().defaultTo(true);

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['shop_id', 'is_default']);
  });

  await knex.raw(`
    ALTER TABLE shop_sender_addresses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_sender_addresses FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`
    DROP POLICY IF EXISTS shop_sender_addresses_tenant_isolation_policy ON shop_sender_addresses;
  `);
  await knex.raw(`
    CREATE POLICY shop_sender_addresses_tenant_isolation_policy
    ON shop_sender_addresses
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP POLICY IF EXISTS shop_sender_addresses_tenant_isolation_policy ON shop_sender_addresses;`);
  await knex.schema.dropTableIfExists('shop_sender_addresses');
}