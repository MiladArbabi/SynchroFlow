import type { Knex } from 'knex';

// Cannot merge into 0008 (predates parcel_tracking_events) or 0118
// (return_jobs doesn't exist yet at that point either — created in
// 0008). This FK is the one genuine ordering dependency between two
// already-merged migrations; everything else from the original
// 0122/0123/0124 series is now folded into 0008/0118 directly.
export async function up(knex: Knex): Promise<void> {
  // IDEMPOTENCY GUARD:
  // On databases that ran the original standalone 0122 migration
  // before the 0122-0125/0080/0116 consolidation (see 75540ae0),
  // this column, its FK, and its index already exist. On fresh
  // installs seeded straight from the consolidated base migrations,
  // they don't. This guard makes 0118a correct on both.
  const hasColumn = await knex.schema.hasColumn(
    'return_jobs',
    'triggering_parcel_tracking_event_id',
  );

  if (hasColumn) {
    console.info(
      '[migration 0118a] triggering_parcel_tracking_event_id already present (added by 0122) — skipping',
    );
    return;
  }

  await knex.schema.alterTable('return_jobs', (table) => {
    table
      .uuid('triggering_parcel_tracking_event_id')
      .nullable()
      .references('id')
      .inTable('parcel_tracking_events')
      .onDelete('SET NULL');
    table.index(['triggering_parcel_tracking_event_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('return_jobs', (table) => {
    table.dropColumn('triggering_parcel_tracking_event_id');
  });
}