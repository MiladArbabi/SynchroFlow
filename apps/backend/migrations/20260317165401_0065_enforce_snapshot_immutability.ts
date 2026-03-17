import type { Knex } from "knex";

/**
 * ============================================================
 * IMMUTABILITY GUARD — OPERATIONAL SNAPSHOT
 * ============================================================
 *
 * Enforces append-only behavior:
 * - NO UPDATE
 * - NO DELETE
 *
 * Prevents silent loss of operational history.
 * ============================================================
 */

export async function up(knex: Knex): Promise<void> {
  /**
   * 1. Create guard function
   */

        /**
         * CONTROLLED BYPASS (TESTING / BACKFILL ONLY)
         * -------------------------------------------
         * Allows mutation ONLY when explicitly enabled at session level.
         *
         * Usage:
         *   SET app.allow_snapshot_mutation = 'true';
         *
         * Guarantees:
         * - Default remains strictly append-only
         * - No silent mutation possible
         */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
    RETURNS trigger AS $$
    BEGIN
        -- NOTE:
        -- current_setting(..., true) returns NULL if not set.
        -- COALESCE ensures deterministic evaluation.
        IF COALESCE(current_setting('app.allow_snapshot_mutation', true), 'false') = 'true' THEN
            IF TG_OP = 'DELETE' THEN
                RETURN OLD;
            END IF;

            RETURN NEW;
        END IF;

        RAISE EXCEPTION '[IMMUTABILITY_VIOLATION] orders_operational_control_snapshot is append-only';
    END;
    $$ LANGUAGE plpgsql;
  `);

  /**
   * 2. Block UPDATE
   */
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_prevent_snapshot_update
    ON orders_operational_control_snapshot;

    CREATE TRIGGER trg_prevent_snapshot_update
    BEFORE UPDATE ON orders_operational_control_snapshot
    FOR EACH ROW
    EXECUTE FUNCTION prevent_snapshot_mutation();
  `);

  /**
   * 3. Block DELETE
   */
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_prevent_snapshot_delete
    ON orders_operational_control_snapshot;

    CREATE TRIGGER trg_prevent_snapshot_delete
    BEFORE DELETE ON orders_operational_control_snapshot
    FOR EACH ROW
    EXECUTE FUNCTION prevent_snapshot_mutation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  /**
   * Rollback: remove triggers + function
   */
  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_prevent_snapshot_update
    ON orders_operational_control_snapshot;
  `);

  await knex.raw(`
    DROP TRIGGER IF EXISTS trg_prevent_snapshot_delete
    ON orders_operational_control_snapshot;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS prevent_snapshot_mutation;
  `);
}