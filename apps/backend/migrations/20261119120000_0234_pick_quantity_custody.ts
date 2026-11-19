import type { Knex } from 'knex';

/**
 * MIGRATION 0234 — Pick quantity-based custody (SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001)
 * -----------------------------------------------------------------------------------------
 * Additive only. Owner decision (Option B, revised): one LSU scan verifies the
 * product at the location; further units of a quantity pick are settled by
 * count. Those settled units were NOT individually verified, so:
 *
 *   pick_scan_unit_settlement      one row per unit record settled by quantity
 *                                  under a confirmed Pick scan. Never written
 *                                  for a scanned unit (that stays in the
 *                                  verified pick_scan_unit_lineage). Rows are
 *                                  insert-only except for the single release
 *                                  transition (released_at / released_reason /
 *                                  replaced_by_unit_id): 'reverified_present' when
 *                                  a later scan proves the unit is still here, or
 *                                  'returned_to_stock' when the record is back in
 *                                  stock by another route before it is settled again.
 *   inventory_units.identity_unverified
 *                                  true on eligible units left at a location
 *                                  after a quantity settlement there: which
 *                                  physical siblings remain is unknown, so their
 *                                  identity is not trusted until a scan
 *                                  re-verifies them.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE inventory_units
      ADD COLUMN identity_unverified boolean NOT NULL DEFAULT false;

    CREATE TABLE pick_scan_unit_settlement (
      scan_id uuid NOT NULL,
      shop_id integer NOT NULL,
      lasyncro_unit_id varchar(20) NOT NULL,
      origin_status varchar(20) NOT NULL CHECK (origin_status IN ('received', 'stowed')),
      origin_location_code varchar(255) NOT NULL,
      settled_at timestamptz NOT NULL DEFAULT now(),
      released_at timestamptz NULL,
      released_reason varchar(40) NULL CHECK (released_reason IS NULL OR released_reason IN ('reverified_present', 'returned_to_stock')),
      replaced_by_unit_id varchar(20) NULL,
      PRIMARY KEY (scan_id, lasyncro_unit_id),
      CHECK ((released_at IS NULL) = (released_reason IS NULL)),
      -- An exchange names the sibling that took the settlement; a record that
      -- came back to stock by another route (e.g. cancelled-pick recovery) has none.
      CHECK ((released_reason = 'reverified_present') = (replaced_by_unit_id IS NOT NULL)),
      FOREIGN KEY (scan_id, shop_id)
        REFERENCES pick_scan_log (scan_id, shop_id) ON DELETE RESTRICT,
      FOREIGN KEY (shop_id, lasyncro_unit_id)
        REFERENCES inventory_units (shop_id, lasyncro_unit_id) ON DELETE RESTRICT
    );
    -- A unit record carries at most one ACTIVE quantity settlement.
    CREATE UNIQUE INDEX pick_scan_unit_settlement_active_unit_uq
      ON pick_scan_unit_settlement (shop_id, lasyncro_unit_id)
      WHERE released_at IS NULL;
    ALTER TABLE pick_scan_unit_settlement ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pick_scan_unit_settlement FORCE ROW LEVEL SECURITY;
    CREATE POLICY pick_scan_unit_settlement_tenant_isolation_policy
      ON pick_scan_unit_settlement
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);

    -- Only the one-way release transition is permitted; deletes never.
    CREATE OR REPLACE FUNCTION prevent_pick_scan_unit_settlement_mutation()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'pick_scan_unit_settlement rows cannot be deleted';
      END IF;
      IF OLD.released_at IS NOT NULL
         OR NEW.scan_id IS DISTINCT FROM OLD.scan_id
         OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
         OR NEW.lasyncro_unit_id IS DISTINCT FROM OLD.lasyncro_unit_id
         OR NEW.origin_status IS DISTINCT FROM OLD.origin_status
         OR NEW.origin_location_code IS DISTINCT FROM OLD.origin_location_code
         OR NEW.settled_at IS DISTINCT FROM OLD.settled_at
         OR NEW.released_at IS NULL THEN
        RAISE EXCEPTION 'pick_scan_unit_settlement permits only a single release transition';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER pick_scan_unit_settlement_guard_update
      BEFORE UPDATE ON pick_scan_unit_settlement
      FOR EACH ROW EXECUTE FUNCTION prevent_pick_scan_unit_settlement_mutation();
    CREATE TRIGGER pick_scan_unit_settlement_guard_delete
      BEFORE DELETE ON pick_scan_unit_settlement
      FOR EACH ROW EXECUTE FUNCTION prevent_pick_scan_unit_settlement_mutation();

    -- 0105's default privileges grant SELECT/INSERT/UPDATE/DELETE on every new
    -- table; narrow them to insert + the single release transition.
    REVOKE ALL ON pick_scan_unit_settlement FROM sf_app;
    GRANT SELECT, INSERT ON pick_scan_unit_settlement TO sf_app;
    GRANT UPDATE (released_at, released_reason, replaced_by_unit_id) ON pick_scan_unit_settlement TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TABLE pick_scan_unit_settlement;
    DROP FUNCTION prevent_pick_scan_unit_settlement_mutation();
    ALTER TABLE inventory_units DROP COLUMN identity_unverified;
  `);
}
