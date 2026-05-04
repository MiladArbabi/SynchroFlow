/**
 * FT2 state — one row per shop. RLS enforced via shop_id (primary key).
 */

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("ft2_state", (table) => {
    /**
     * shop_id is the primary identity.
     * Exactly one row per shop.
     */
    table
      .integer("shop_id")
      .notNullable()
      .primary()
      .references("id")
      .inTable("shops")
      .onDelete("CASCADE");

    table.timestamp("completed_at", { useTz: true }).nullable();

    table.string("evaluator_version", 255).nullable();

    table
      .jsonb("evaluation_snapshot")
      .notNullable()
      .defaultTo("{}");

    table
      .timestamp("created_at", { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  /**
   * HARD IMMUTABILITY GUARD
   * -----------------------
   * FT2 completion is irreversible.
   * Once written, row must never be updated or deleted.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_ft2_state_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'ft2_state is immutable once written';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER ft2_state_no_update
    BEFORE UPDATE ON ft2_state
    FOR EACH ROW
    EXECUTE FUNCTION prevent_ft2_state_mutation();
  `);

  await knex.raw(`
    CREATE TRIGGER ft2_state_no_delete
    BEFORE DELETE ON ft2_state
    FOR EACH ROW
    EXECUTE FUNCTION prevent_ft2_state_mutation();
  `);

  // --- RLS: tenant isolation (shop_id is PK — direct enforcement) ---
  await knex.raw(`
    ALTER TABLE ft2_state ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ft2_state FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`
    DROP POLICY IF EXISTS ft2_state_tenant_isolation_policy ON ft2_state;
    CREATE POLICY ft2_state_tenant_isolation_policy
    ON ft2_state
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("ft2_state");
}