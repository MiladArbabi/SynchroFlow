import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  /**
   * PROJECTION WRITE GUARD
   * ----------------------
   * Only projection.engine is allowed to mutate projection tables.
   *
   * Enforced via session variable:
   *   SET LOCAL synchroflow.projection = 'true'
   */

  const tables = [
    'order_fulfillment_status',
    'order_age_snapshot',
    'order_constraints',
    'order_risk_snapshot',
    'order_margin_snapshot'
  ];

  for (const table of tables) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION enforce_projection_writer_${table}()
      RETURNS trigger AS $$
      BEGIN
        IF current_setting('synchroflow.projection', true) IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION
            '[PROJECTION_WRITE_VIOLATION] table=${table} must be written only by projection.engine';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await knex.raw(`
      DROP TRIGGER IF EXISTS projection_writer_guard_${table} ON ${table};
    `);

    await knex.raw(`
      CREATE TRIGGER projection_writer_guard_${table}
      BEFORE INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW
      EXECUTE FUNCTION enforce_projection_writer_${table}();
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'order_fulfillment_status',
    'order_age_snapshot',
    'order_constraints',
    'order_risk_snapshot',
    'order_margin_snapshot'
  ];

  for (const table of tables) {
    await knex.raw(`
      DROP TRIGGER IF EXISTS projection_writer_guard_${table} ON ${table};
    `);

    await knex.raw(`
      DROP FUNCTION IF EXISTS enforce_projection_writer_${table};
    `);
  }
}