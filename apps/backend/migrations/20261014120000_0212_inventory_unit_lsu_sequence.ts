import type { Knex } from 'knex';

/** GH-1255 LSU-IDENTITY-01. The one global source of new unit identities.
 *
 * New units are labelled 'LSU-' + exactly 10 zero-padded digits taken from
 * this sequence. MAXVALUE is the largest 10-digit value and NO CYCLE makes
 * exhaustion an error instead of a reissue. Legacy 'LSU-' + 8 hex identities
 * are untouched: no LSU column is widened and no row is rewritten.
 *
 * Least privilege: the schema default ACL (0105) hands sf_app USAGE and SELECT
 * on every new sequence. sf_app needs nextval() only, so it keeps USAGE and
 * never SELECT or UPDATE (no setval / rewind).
 */
const SEQUENCE = 'public.inventory_unit_lsu_seq';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE SEQUENCE ${SEQUENCE} AS bigint
      START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
    REVOKE ALL ON SEQUENCE ${SEQUENCE} FROM PUBLIC;
    REVOKE ALL ON SEQUENCE ${SEQUENCE} FROM sf_app;
    GRANT USAGE ON SEQUENCE ${SEQUENCE} TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Dropping the sequence after it issued identities would let a later
  // re-create restart at 1 against units that already carry those numbers.
  await knex.raw(`LOCK TABLE inventory_units IN ACCESS EXCLUSIVE MODE`);
  await knex.raw(`SET LOCAL row_security = off`);
  const result = await knex.raw(`
    SELECT EXISTS (SELECT 1 FROM inventory_units WHERE lasyncro_unit_id ~ '^LSU-[0-9]{10}$') AS issued
  `);
  if (result.rows[0]?.issued) {
    throw new Error(
      '[INVENTORY_UNIT_LSU_SEQUENCE_ROLLBACK_BLOCKED] sequence-issued LSU identities exist; 0212 cannot be removed'
    );
  }
  await knex.raw(`DROP SEQUENCE ${SEQUENCE}`);
}
