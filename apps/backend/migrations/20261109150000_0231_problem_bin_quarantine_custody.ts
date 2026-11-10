import type { Knex } from 'knex';

/**
 * MIGRATION 0231 — Problem Bin quarantine custody (SF-PROBLEM-BIN Phase A)
 * -----------------------------------------------------------------------
 * Warehouse-wide, task-independent quarantine of one exact LSU into a
 * non-pickable Problem Bin. Dark until safe Problem Center resolution exists
 * (server flag PROBLEM_BIN_QUARANTINE_ENABLED, default OFF).
 *
 *   inventory_units      domain-neutral 'quarantined' status + custody origin
 *                        (quarantined_from_location / _status); guarded so a
 *                        unit enters quarantine only with a matching custody
 *                        event and an active incident, and is frozen after.
 *   problem_center_*     neutral source 'warehouse'; one ACTIVE quarantine
 *                        incident per LSU. Scoped to quarantine incidents so
 *                        the 0224 contract (only Receive is one-per-LSU; other
 *                        sources unaffected) is preserved. The shared writer
 *                        also refuses an LSU with an active incident of ANY
 *                        source, under the unit row lock.
 *   problem_bin_custody_events  append-only replay/custody authority.
 *   stow_tasks           quantity_excepted + 'finished_with_exceptions' —
 *                        Stow-adapter task accounting only.
 *
 * Enum labels added here are not used as literals in this transaction
 * (PostgreSQL forbids using a new label before commit); guards compare ::text.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE inventory_unit_lifecycle_status ADD VALUE IF NOT EXISTS 'quarantined';
    ALTER TYPE stow_task_status ADD VALUE IF NOT EXISTS 'finished_with_exceptions';
    ALTER TYPE problem_center_source ADD VALUE IF NOT EXISTS 'warehouse';

    ALTER TABLE stow_tasks ADD COLUMN quantity_excepted integer NOT NULL DEFAULT 0;
    ALTER TABLE stow_tasks ADD CONSTRAINT stow_tasks_accounted_quantity_check
      CHECK (quantity_excepted >= 0 AND quantity_placed + quantity_excepted <= quantity) NOT VALID;
    ALTER TABLE stow_tasks VALIDATE CONSTRAINT stow_tasks_accounted_quantity_check;

    ALTER TABLE inventory_units
      ADD COLUMN quarantined_from_location varchar(255) NULL,
      ADD COLUMN quarantined_from_status inventory_unit_lifecycle_status NULL;
    ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_quarantine_origin_check
      CHECK (status::text <> 'quarantined' OR (current_location_code IS NOT NULL
        AND quarantined_from_location IS NOT NULL AND quarantined_from_status IS NOT NULL)) NOT VALID;
    ALTER TABLE inventory_units VALIDATE CONSTRAINT inventory_units_quarantine_origin_check;

    -- exception_type (varchar), not the new 'warehouse' label: a label added in
    -- this transaction cannot be referenced before commit.
    CREATE UNIQUE INDEX problem_center_active_quarantine_unit_unique
      ON problem_center_tasks (shop_id, lasyncro_unit_id)
      WHERE exception_type = 'quarantined_unit' AND lasyncro_unit_id IS NOT NULL
        AND status IN ('open', 'investigating');

    CREATE TABLE problem_bin_custody_events (
      shop_id integer NOT NULL REFERENCES shops(id),
      device_event_id uuid NOT NULL,
      lasyncro_unit_id varchar(20) NOT NULL,
      problem_bin_scan varchar(255) NOT NULL,
      problem_bin_location varchar(255) NOT NULL,
      source_location varchar(255) NOT NULL,
      source_status varchar(20) NOT NULL CHECK (source_status IN ('received', 'stowed')),
      context_kind varchar(20) NOT NULL CHECK (context_kind IN ('free_scan', 'stow')),
      stow_task_id uuid NULL REFERENCES stow_tasks(stow_task_id),
      operator_id integer NOT NULL REFERENCES users(id),
      problem_task_id uuid NOT NULL REFERENCES problem_center_tasks(problem_task_id),
      result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, device_event_id),
      UNIQUE (shop_id, problem_task_id),
      CHECK ((context_kind = 'stow') = (stow_task_id IS NOT NULL)),
      CHECK (problem_bin_location <> source_location)
    );
    CREATE INDEX problem_bin_custody_events_unit_idx ON problem_bin_custody_events (shop_id, lasyncro_unit_id);
    ALTER TABLE problem_bin_custody_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE problem_bin_custody_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY problem_bin_custody_events_tenant_isolation ON problem_bin_custody_events
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
    REVOKE ALL ON problem_bin_custody_events FROM sf_app;
    GRANT SELECT, INSERT ON problem_bin_custody_events TO sf_app;

    CREATE FUNCTION prevent_problem_bin_custody_event_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'problem_bin_custody_events is append-only';
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER problem_bin_custody_events_immutable BEFORE UPDATE OR DELETE ON problem_bin_custody_events
      FOR EACH ROW EXECUTE FUNCTION prevent_problem_bin_custody_event_mutation();

    -- Application-role guard (same session_user convention as 0226). Phase A
    -- has no resolution path, so a quarantined unit's custody is frozen.
    CREATE FUNCTION guard_problem_bin_unit_custody() RETURNS trigger AS $$
    BEGIN
      IF session_user <> 'sf_app' THEN
        RETURN NEW;
      END IF;
      IF OLD.status::text = 'quarantined' THEN
        IF NEW.status IS DISTINCT FROM OLD.status
           OR NEW.current_location_code IS DISTINCT FROM OLD.current_location_code
           OR NEW.quarantined_from_location IS DISTINCT FROM OLD.quarantined_from_location
           OR NEW.quarantined_from_status IS DISTINCT FROM OLD.quarantined_from_status THEN
          RAISE EXCEPTION 'PROBLEM_BIN_CUSTODY_IMMUTABLE: % custody cannot change', OLD.lasyncro_unit_id
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.status::text = 'quarantined' THEN
        IF NEW.quarantined_from_status::text IS DISTINCT FROM OLD.status::text
           OR NOT EXISTS (
             SELECT 1 FROM problem_bin_custody_events e
               JOIN problem_center_tasks t
                 ON t.shop_id = e.shop_id AND t.problem_task_id = e.problem_task_id
              WHERE e.shop_id = OLD.shop_id AND e.lasyncro_unit_id = OLD.lasyncro_unit_id
                AND e.problem_bin_location = NEW.current_location_code
                AND e.source_location = NEW.quarantined_from_location
                AND e.source_status = OLD.status::text
                AND t.lasyncro_unit_id = OLD.lasyncro_unit_id
                AND t.status IN ('open', 'investigating')) THEN
          RAISE EXCEPTION 'PROBLEM_BIN_CUSTODY_EVENT_REQUIRED: % has no matching custody event', OLD.lasyncro_unit_id
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.quarantined_from_location IS DISTINCT FROM OLD.quarantined_from_location
         OR NEW.quarantined_from_status IS DISTINCT FROM OLD.quarantined_from_status THEN
        RAISE EXCEPTION 'PROBLEM_BIN_CUSTODY_EVENT_REQUIRED: % origin is set only on quarantine', OLD.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER inventory_units_guard_problem_bin_custody BEFORE UPDATE ON inventory_units
      FOR EACH ROW EXECUTE FUNCTION guard_problem_bin_unit_custody();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`LOCK TABLE problem_bin_custody_events, stow_tasks, inventory_units, problem_center_tasks IN ACCESS EXCLUSIVE MODE`);
  await knex.raw(`SET LOCAL row_security = off`);
  const result = await knex.raw(`SELECT EXISTS (SELECT 1 FROM problem_bin_custody_events)
    OR EXISTS (SELECT 1 FROM stow_tasks WHERE quantity_excepted > 0 OR status::text = 'finished_with_exceptions')
    OR EXISTS (SELECT 1 FROM inventory_units WHERE status::text = 'quarantined' OR quarantined_from_location IS NOT NULL)
    OR EXISTS (SELECT 1 FROM problem_center_tasks WHERE source::text = 'warehouse') AS used`);
  if (result.rows[0].used) throw new Error('PROBLEM_BIN_QUARANTINE_ROLLBACK_BLOCKED');
  await knex.raw(`
    DROP TRIGGER inventory_units_guard_problem_bin_custody ON inventory_units;
    DROP FUNCTION guard_problem_bin_unit_custody();
    DROP TABLE problem_bin_custody_events;
    DROP FUNCTION prevent_problem_bin_custody_event_mutation();
    DROP INDEX problem_center_active_quarantine_unit_unique;
    ALTER TABLE inventory_units DROP CONSTRAINT inventory_units_quarantine_origin_check;
    ALTER TABLE inventory_units DROP COLUMN quarantined_from_status, DROP COLUMN quarantined_from_location;
    ALTER TABLE stow_tasks DROP CONSTRAINT stow_tasks_accounted_quantity_check;
    ALTER TABLE stow_tasks DROP COLUMN quantity_excepted;`);
  // PostgreSQL enum labels remain, as in 0224. No persisted evidence is removed.
}
