// apps/backend/migrations/20260704160000_0122_return_jobs_carrier_linkage.ts

import type { Knex } from 'knex';

/**
 * MIGRATION 0122 — Return Jobs ↔ Carrier Tracking Linkage
 * ---------------------------------------------------------
 * WHY THIS MIGRATION EXISTS (not folded into 0008):
 * return_jobs was created in migration 0008 (Feb 12), before
 * parcel_tracking_events existed (introduced in 0118, July 2).
 * A forward FK cannot be added retroactively into 0008 without
 * breaking `db:reset` / fresh migrate-from-zero ordering. This
 * migration adds the dependency at the correct point in history.
 *
 * PURPOSE:
 * Closes RET-AUD-06 / RET-AUD-10 — today, a carrier "returned to
 * sender" webhook event (see carrier-integration.md §4, event_type
 * = 'returned') can only write an `alerts` row. There is no way to
 * trace an auto-created return_job back to the specific parcel scan
 * that triggered it, and no way to distinguish an operator-created
 * job from a system-created one.
 *
 * Two additive columns on return_jobs:
 *
 * 1. source — who/what created this job.
 *    'operator'        : created via mobile scan (existing behavior,
 *                         default — every historical row backfills here)
 *    'carrier_webhook'  : auto-created from a parcel_tracking_events
 *                         'returned' event, BEFORE the physical parcel
 *                         has arrived (status will be 'expected' —
 *                         see status column comment in 0008; 'expected'
 *                         is a new value, added by convention since
 *                         status is a plain varchar(50), not a DB enum)
 *
 * 2. triggering_parcel_tracking_event_id — nullable FK to the exact
 *    parcel_tracking_events row that caused this job to be created.
 *    NULL for all 'operator'-sourced jobs. ON DELETE SET NULL, not
 *    CASCADE — losing the tracking-event audit row must never delete
 *    a return_job that may already be mid-resolution.
 *
 * NOT done here (deliberately, scope discipline):
 * - No new return_job_origin_type enum value. 'undelivered_return'
 *   already covers this case conceptually; 'source' answers "who
 *   created it", origin answers "what kind of return is it". Adding
 *   a redundant origin value would let the two dimensions drift.
 * - No service-layer code (createReturnJobFromCarrierEvent, etc.) —
 *   schema first, service wiring is a separate, smaller-diff task.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('return_jobs', (table) => {
    table
      .string('source', 20)
      .notNullable()
      .defaultTo('operator');
    // values: 'operator' | 'carrier_webhook'

    table
      .uuid('triggering_parcel_tracking_event_id')
      .nullable()
      .references('id')
      .inTable('parcel_tracking_events')
      .onDelete('SET NULL');

    table.index(['triggering_parcel_tracking_event_id']);
    table.index(['shop_id', 'source']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('return_jobs', (table) => {
    table.dropColumn('triggering_parcel_tracking_event_id');
    table.dropColumn('source');
  });
}