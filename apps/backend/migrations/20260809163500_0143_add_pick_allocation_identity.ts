import type { Knex } from 'knex';

/**
 * MIGRATION 0143 — add_pick_allocation_identity
 * ------------------------------------------------
 * Connects physical pick outcomes to the exact reservation allocation.
 *
 * Historical rows remain valid with NULL allocation identity.
 * New allocation-backed pick flows may persist allocation_id on:
 *   - confirmed pick scans
 *   - pick-stage exceptions
 *
 * Runtime behavior is introduced separately after this schema migration
 * is verified.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pick_scan_log', (table) => {
    table
      .uuid('reservation_allocation_id')
      .nullable()
      .references('allocation_id')
      .inTable('pick_reservation_allocations')
      .onDelete('RESTRICT');

    table.index(
      ['reservation_allocation_id'],
      'pick_scan_log_reservation_allocation_idx'
    );
  });

  await knex.schema.alterTable('pick_exceptions', (table) => {
    table
      .uuid('reservation_allocation_id')
      .nullable()
      .references('allocation_id')
      .inTable('pick_reservation_allocations')
      .onDelete('RESTRICT');

    table.index(
      ['reservation_allocation_id'],
      'pick_exceptions_reservation_allocation_idx'
    );
  });

  /**
   * One successful physical confirmation per allocation.
   *
   * NULL historical rows are intentionally excluded.
   */
  await knex.raw(`
    CREATE UNIQUE INDEX
      pick_scan_log_confirmed_allocation_unique
    ON pick_scan_log (reservation_allocation_id)
    WHERE reservation_allocation_id IS NOT NULL
      AND status = 'confirmed';
  `);

  /**
   * One pick-stage exception outcome per allocation.
   *
   * Pack-stage exceptions remain line/order oriented and are unaffected.
   */
  await knex.raw(`
    CREATE UNIQUE INDEX
      pick_exceptions_pick_allocation_unique
    ON pick_exceptions (reservation_allocation_id)
    WHERE reservation_allocation_id IS NOT NULL
      AND stage = 'pick';
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP INDEX IF EXISTS
      pick_scan_log_confirmed_allocation_unique;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS
      pick_exceptions_pick_allocation_unique;
  `);

  await knex.schema.alterTable('pick_scan_log', (table) => {
    table.dropIndex(
      ['reservation_allocation_id'],
      'pick_scan_log_reservation_allocation_idx'
    );

    table.dropColumn('reservation_allocation_id');
  });

  await knex.schema.alterTable('pick_exceptions', (table) => {
    table.dropIndex(
      ['reservation_allocation_id'],
      'pick_exceptions_reservation_allocation_idx'
    );

    table.dropColumn('reservation_allocation_id');
  });
}
