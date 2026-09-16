import type { Knex } from 'knex';

/**
 * MIGRATION 0180 — carrier tracking reconciliation metadata (#1114)
 *
 * Adds provider-authoritative carrier metadata required for tracking
 * reconciliation without changing existing shipment truth:
 *
 * - provider_carrier_account_id:
 *   Shippo rate.carrier_account captured at label purchase time.
 *
 * - provider_carrier_code:
 *   Canonical provider carrier token resolved best-effort later.
 *
 * Both are nullable because historical Shippo shipments cannot be safely
 * reconstructed and Sendcloud shipments do not require either value.
 *
 * Also introduces an isolated `sendcloud_v3` carrier_status_map namespace
 * for Sendcloud v3 parent_status values. This is a normalization lookup
 * namespace only; business-facing carrier/source identity remains
 * `sendcloud`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_shipment_tracking', (table) => {
    table.text('provider_carrier_account_id').nullable();
    table.text('provider_carrier_code').nullable();
  });

  await knex('carrier_status_map').insert([
    {
      carrier_code: 'sendcloud_v3',
      raw_status: 'Announced',
      event_type: 'announced',
    },
    {
      carrier_code: 'sendcloud_v3',
      raw_status: 'Parcel en route',
      event_type: 'in_transit',
    },
    {
      carrier_code: 'sendcloud_v3',
      raw_status: 'Driver en route',
      event_type: 'out_for_delivery',
    },
    {
      carrier_code: 'sendcloud_v3',
      raw_status: 'Delivered',
      event_type: 'delivered',
    },
    {
      carrier_code: 'sendcloud_v3',
      raw_status: 'Delivery attempt failed',
      event_type: 'exception',
    },
    {
      carrier_code: 'sendcloud_v3',
      raw_status: 'Unable to deliver',
      event_type: 'exception',
    },
    {
      carrier_code: 'sendcloud_v3',
      raw_status: 'Exception',
      event_type: 'exception',
    },
    {
      carrier_code: 'sendcloud_v3',
      raw_status: 'Returned to sender',
      event_type: 'returned',
    },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  await knex('carrier_status_map')
    .where({ carrier_code: 'sendcloud_v3' })
    .del();

  await knex.schema.alterTable('order_shipment_tracking', (table) => {
    table.dropColumn('provider_carrier_account_id');
    table.dropColumn('provider_carrier_code');
  });
}
