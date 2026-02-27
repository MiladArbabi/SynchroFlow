import type { Knex } from 'knex';

/**
 * PROJECTION CURSORS
 * ------------------
 * Tracks deterministic projection progress.
 *
 * Rules:
 * - One row per projection
 * - Monotonic advancement only
 * - No domain mutation coupling
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('projection_cursors', (table) => {
    table.string('projection_name').primary();

    table
      .bigInteger('last_processed_event_id')
      .notNullable();

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  /**
   * Prevent accidental deletion.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_projection_cursor_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'projection_cursors rows cannot be deleted';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER projection_cursors_no_delete
    BEFORE DELETE ON projection_cursors
    FOR EACH ROW EXECUTE FUNCTION prevent_projection_cursor_delete();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('projection_cursors');
}