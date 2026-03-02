import { Knex } from 'knex';

/**
 * ============================================================
 * FT0 STATE (SOVEREIGN)
 * ============================================================
 *
 * Represents system-readiness completion per shop.
 *
 * Invariants:
 * - Exactly one row per shop
 * - Idempotent completion
 * - Completion is irreversible
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ft0_state', table => {
    /**
     * shop_id is the primary identity.
     * Exactly one row per shop.
     */
    table
      .integer('shop_id')
      .notNullable()
      .primary()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .string('status')
      .notNullable(); // e.g. COMPLETED

    table
      .timestamp('completed_at')
      .nullable();

    table
      .jsonb('completion_reason')
      .notNullable()
      .defaultTo('{}');

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

    /**
   * HARD IMMUTABILITY GUARD
   * -----------------------
   * FT0 completion is irreversible.
   * Rows must never be updated or deleted.
   */

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_ft0_state_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'ft0_state is immutable once written';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ft0_state_no_update
    BEFORE UPDATE ON ft0_state
    FOR EACH ROW EXECUTE FUNCTION prevent_ft0_state_mutation();
  `);

  await knex.raw(`
    CREATE TRIGGER ft0_state_no_delete
    BEFORE DELETE ON ft0_state
    FOR EACH ROW EXECUTE FUNCTION prevent_ft0_state_mutation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ft0_state');
}
