// Hard deprecation of canonical_returns
// --------------------------------------
// Guarantees:
// - No INSERT / UPDATE / DELETE allowed
// - Refund execution pipeline is authoritative
// - Protection survives DB resets

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Ensure clean state (idempotent)
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_block_canonical_returns_mutation
    ON canonical_returns;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS block_canonical_returns_mutation();
  `);

  await knex.raw(`
    CREATE FUNCTION block_canonical_returns_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        'canonical_returns is deprecated. Refund execution pipeline is authoritative.';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_block_canonical_returns_mutation
    BEFORE INSERT OR UPDATE OR DELETE
    ON canonical_returns
    FOR EACH ROW
    EXECUTE FUNCTION block_canonical_returns_mutation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_block_canonical_returns_mutation
    ON canonical_returns;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS block_canonical_returns_mutation();
  `);
}