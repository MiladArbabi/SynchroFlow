import type { Knex } from 'knex';

/**
 * MIGRATION 0176 — parcel_tracking_events.event_type: add 'unknown' (DR-02-MIGR-01, #1114)
 *
 * DR-02 audit (#1114) found parcel_tracking_events.event_type NOT NULL +
 * CHECK-constrained to exactly 6 values (announced/in_transit/
 * out_for_delivery/delivered/exception/returned), with no legal way to
 * record a raw carrier status that carrier_status_map has no mapping for.
 * The handler previously coerced an unmapped status to 'in_transit'
 * (fabricating health) — DR-02 fixed every other consumer
 * (order_shipment_tracking.latest_status, alerts) to say 'unknown'
 * honestly, but this one column was left on the old placeholder pending
 * this migration, exactly as documented in carrierTrackingNormalization.ts.
 *
 * Scope, deliberately narrow:
 * - Only parcel_tracking_events.event_type's CHECK constraint changes.
 * - carrier_status_map.event_type is NOT touched. It is a reference table
 *   of KNOWN carrier_code -> raw_status -> canonical mapping; there is no
 *   'unknown' *mapping* to seed — 'unknown' is what the ABSENCE of a
 *   carrier_status_map row already means, and that lookup-miss semantic is
 *   unchanged by this migration. Adding 'unknown' there would invite a
 *   future seed row that doesn't correspond to any real raw provider
 *   status, which is exactly the kind of fabrication DR-02 was fixing.
 * - No seed data added or changed. No raw_status/raw_payload column
 *   touched. No backfill of existing rows (event_type is NOT NULL and no
 *   existing row could have been 'unknown' before this migration existed).
 */
const CONSTRAINT_NAME = 'parcel_tracking_events_event_type_check';
const PRE_EXISTING_VALUES = [
  'announced',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception',
  'returned',
];
const NEW_VALUES = [...PRE_EXISTING_VALUES, 'unknown'];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE parcel_tracking_events DROP CONSTRAINT ${CONSTRAINT_NAME}`
  );
  await knex.raw(
    `ALTER TABLE parcel_tracking_events ADD CONSTRAINT ${CONSTRAINT_NAME} CHECK (event_type IN (${NEW_VALUES.map((v) => `'${v}'`).join(', ')}))`
  );
}

export async function down(knex: Knex): Promise<void> {
  // Fail closed rather than silently drop rows: if any row is already
  // 'unknown', the pre-DR-02 constraint cannot be restored without either
  // deleting evidence or leaving the DB in a state the old constraint
  // rejects. Neither is this migration's call to make.
  const unknownRows = await knex('parcel_tracking_events')
    .where({ event_type: 'unknown' })
    .count<{ count: string }>('* as count')
    .first();

  if (Number(unknownRows?.count ?? 0) > 0) {
    throw new Error(
      '[0176_DOWN_BLOCKED] parcel_tracking_events has rows with event_type=\'unknown\' — ' +
      'rolling back would violate the pre-migration CHECK constraint. Resolve those rows explicitly before reverting.'
    );
  }

  await knex.raw(
    `ALTER TABLE parcel_tracking_events DROP CONSTRAINT ${CONSTRAINT_NAME}`
  );
  await knex.raw(
    `ALTER TABLE parcel_tracking_events ADD CONSTRAINT ${CONSTRAINT_NAME} CHECK (event_type IN (${PRE_EXISTING_VALUES.map((v) => `'${v}'`).join(', ')}))`
  );
}
