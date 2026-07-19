// apps/backend/migrations/20260704170000_0123_carrier_status_fault_category.ts

import type { Knex } from 'knex';

/**
 * MIGRATION 0123 — Carrier Status Fault Attribution
 * ----------------------------------------------------
 * Closes RET-AUD-08 / RET-AUD-53: parcel_tracking_events.raw_status is
 * captured and persisted correctly at ingestion, but nothing downstream
 * (Sendcloud handler has no 'returned' branch at all — RET-AUD-52;
 * Shippo's alert message is a generic "was reported as returned",
 * carrying no fault signal) ever uses it.
 *
 * HONEST LIMIT, STATED UP FRONT:
 * carrier_status_map.raw_status is a carrier-simplified string. Neither
 * Sendcloud nor Shippo's tracking webhook payload encodes *why* a
 * parcel is returning at this granularity — 'returned_to_sender' means
 * the same string whether the cause was a refused delivery, an
 * unclaimed pickup, a bad address, or a carrier routing error. This
 * migration can only mark fault_category where the raw string itself
 * is unambiguous (damaged, lost → carrier-side mishandling). Every
 * 'returned' variant is genuinely 'unknown' from this data alone — this
 * is not a gap in the mapping, it's a gap in what carriers report at
 * this API tier. True fault attribution would require per-carrier
 * granular reason codes (Sendcloud's fuller status detail API, or
 * Shippo's tracking_status.status_details), which is a separate,
 * larger integration — not something a column backfill can manufacture.
 *
 * fault_category values:
 *   'carrier_fault'  — string itself implies carrier mishandling
 *   'customer_fault' — string itself implies customer-side cause
 *   'unknown'        — cannot be determined from raw_status alone
 *   NULL             — not applicable (non-exception, non-returned event types)
 *
 * Consumers (not built in this migration — schema first):
 * - sendcloud.tracking.handler.ts needs an 'returned' branch added
 *   (currently missing entirely, see RET-AUD-52)
 * - shippo.tracking.handler.ts's existing 'returned' branch should read
 *   this column into the alert message/metadata instead of a fixed
 *   generic string
 */
export async function up(knex: Knex): Promise<void> {
  // IDEMPOTENCY GUARD:
  // 0118 (consolidated version) creates carrier_status_map with
  // fault_category already built in and pre-seeded (see 0118 lines
  // 97, 112-120). This migration originally ran standalone, before
  // consolidation, on databases like prod, where it still owns the
  // column and backfill. On fresh installs seeded from 0118 directly,
  // both the column and the backfill values already exist — skip both.
  const hasFaultCategory = await knex.schema.hasColumn(
    'carrier_status_map',
    'fault_category',
  );

  if (hasFaultCategory) {
    console.info(
      '[migration 0123] carrier_status_map.fault_category already present (added by 0118) — skipping',
    );
    return;
  }

  await knex.schema.alterTable('carrier_status_map', (table) => {
    table
      .string('fault_category', 20)
      .nullable()
      .checkIn(['carrier_fault', 'customer_fault', 'unknown']);
  });
  // Only the two raw_status strings whose wording is itself unambiguous.
  // Every other 'exception' or 'returned' row is deliberately left as
  // 'unknown' — see up() comment above for why that's correct, not lazy.
  await knex('carrier_status_map')
    .where({ carrier_code: 'sendcloud', raw_status: 'damaged' })
    .update({ fault_category: 'carrier_fault' });

  await knex('carrier_status_map')
    .where({ carrier_code: 'sendcloud', raw_status: 'lost' })
    .update({ fault_category: 'carrier_fault' });

  await knex('carrier_status_map')
    .whereIn('event_type', ['exception', 'returned'])
    .whereNull('fault_category')
    .update({ fault_category: 'unknown' });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('carrier_status_map', (table) => {
    table.dropColumn('fault_category');
  });
}