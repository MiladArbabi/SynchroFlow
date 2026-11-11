import type { Knex } from 'knex';

/**
 * MIGRATION 0232 — Problem Bin resolution (SF-PROBLEM-BIN Phase B, slice S2)
 * -------------------------------------------------------------------------
 * Barcode-verified resolution of a Phase A (0231) quarantined LSU, and
 * per-member problem-solver authority. 0231 is not modified; its unit guard
 * function is REPLACED here (and restored verbatim by DOWN).
 *
 *   inventory_units            domain-neutral 'written_off' status: removed from
 *                              stock by an approved write-off. Not 'discarded',
 *                              which is Receive-held vocabulary (HELD_UNIT_STATUSES)
 *                              and would be counted as held by Receive readiness.
 *   problem_bin_custody_events quarantine_reason (routine | damaged | defective):
 *                              the minimal classification that separates routine
 *                              recovery from damaged/defective stock. NULL only for
 *                              rows written before 0232 (treated as non-routine).
 *   problem_bin_resolution_events  append-only, FORCE RLS; one decision per
 *                              incident; validated against incident, custody and
 *                              unit state, and against problem-solver authority.
 *   problem_solver_designations    per-member, grantable and revocable; history is
 *                              kept (revocation stamps, never deletes).
 *
 * 0227 fix: guard_receive_task_custody's closure rule ("a Receive unit task
 * closes only with its outcome event") matched every task with an LSU, so a
 * 0231 quarantine incident could never close. It is scoped to source 'receive'
 * here; Receive behaviour is unchanged. DOWN restores the 0227 body verbatim.
 *
 * Guards (application role only — session_user precedent 0219/0220/0223/0226/0231):
 *   - a quarantined unit leaves custody ONLY to the state its incident's
 *     resolution event names (released → stowed at the destination; written_off
 *     → written_off, no location), and its origin columns are cleared;
 *   - a quarantine incident closes ONLY with its resolution event, and a closed
 *     quarantine incident is final.
 *
 * Enum labels added here are compared as ::text (not usable as literals before
 * commit — 0224/0231 precedent).
 */

/** 0227 head definition, restored verbatim by DOWN. */
const GUARD_RECEIVE_TASK_0227 = `
    CREATE OR REPLACE FUNCTION guard_receive_task_custody()
    RETURNS trigger AS $$
    DECLARE
      custody_location varchar(255);
    BEGIN
      IF session_user <> 'sf_app' THEN
        RETURN NEW;
      END IF;
      IF OLD.lasyncro_unit_id IS NULL AND NEW.lasyncro_unit_id IS NULL THEN
        RETURN NEW;
      END IF;
      IF NEW.shop_id IS DISTINCT FROM OLD.shop_id
         OR NEW.source IS DISTINCT FROM OLD.source
         OR NEW.lasyncro_unit_id IS DISTINCT FROM OLD.lasyncro_unit_id THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_IMMUTABLE: task % unit identity is fixed', OLD.problem_task_id
          USING ERRCODE = 'P0001';
      END IF;

      -- 0227: a Receive unit task closes only with its outcome event; closed is final.
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status::text NOT IN ('open', 'investigating') THEN
          RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_TASK_FINAL: task % is already closed', OLD.problem_task_id
            USING ERRCODE = 'P0001';
        END IF;
        IF NEW.status::text NOT IN ('open', 'investigating') AND NOT EXISTS (
          SELECT 1 FROM receive_held_recovery_events
           WHERE shop_id = OLD.shop_id AND problem_task_id = OLD.problem_task_id
        ) THEN
          RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_OUTCOME_REQUIRED: task % has no recovery outcome', OLD.problem_task_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;

      IF NEW.problem_bin_location IS NOT DISTINCT FROM OLD.problem_bin_location THEN
        RETURN NEW;
      END IF;

      SELECT location_code INTO custody_location FROM receive_held_custody_events
       WHERE shop_id = OLD.shop_id AND problem_task_id = OLD.problem_task_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_EVENT_REQUIRED: task % has no custody event', OLD.problem_task_id
          USING ERRCODE = 'P0001';
      END IF;
      IF OLD.problem_bin_location IS NULL AND NEW.problem_bin_location = custody_location THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_IMMUTABLE: task % bin cannot change', OLD.problem_task_id
        USING ERRCODE = 'P0001';
    END;
    $$ LANGUAGE plpgsql;`;

const GUARD_0231 = `
    CREATE OR REPLACE FUNCTION guard_problem_bin_unit_custody() RETURNS trigger AS $$
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
    END; $$ LANGUAGE plpgsql;`;

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE inventory_unit_lifecycle_status ADD VALUE IF NOT EXISTS 'written_off';

    ALTER TABLE problem_bin_custody_events ADD COLUMN quarantine_reason varchar(20) NULL;
    ALTER TABLE problem_bin_custody_events ADD CONSTRAINT problem_bin_custody_events_reason_check
      CHECK (quarantine_reason IS NULL OR quarantine_reason IN ('routine', 'damaged', 'defective'));

    -- ── Per-member problem-solver designation ──────────────────────────────
    CREATE TABLE problem_solver_designations (
      designation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id integer NOT NULL REFERENCES shops(id),
      user_id integer NOT NULL REFERENCES users(id),
      granted_by integer NOT NULL REFERENCES users(id),
      granted_at timestamptz NOT NULL DEFAULT now(),
      revoked_by integer NULL REFERENCES users(id),
      revoked_at timestamptz NULL,
      CONSTRAINT problem_solver_designations_revocation_check
        CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
    );
    CREATE UNIQUE INDEX problem_solver_designations_active_unique
      ON problem_solver_designations (shop_id, user_id) WHERE revoked_at IS NULL;
    ALTER TABLE problem_solver_designations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE problem_solver_designations FORCE ROW LEVEL SECURITY;
    CREATE POLICY problem_solver_designations_tenant_isolation ON problem_solver_designations
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
    REVOKE ALL ON problem_solver_designations FROM sf_app;
    GRANT SELECT, INSERT, UPDATE ON problem_solver_designations TO sf_app;

    -- Only revocation may change a row, once; identity and grant are fixed.
    CREATE FUNCTION guard_problem_solver_designation() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'PROBLEM_SOLVER_DESIGNATION_IMMUTABLE: designations are revoked, never deleted';
      END IF;
      IF OLD.revoked_at IS NOT NULL
         OR NEW.revoked_at IS NULL
         OR NEW.designation_id IS DISTINCT FROM OLD.designation_id
         OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
         OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
        RAISE EXCEPTION 'PROBLEM_SOLVER_DESIGNATION_IMMUTABLE: only an active designation may be revoked, once';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER problem_solver_designations_guard BEFORE UPDATE OR DELETE ON problem_solver_designations
      FOR EACH ROW EXECUTE FUNCTION guard_problem_solver_designation();

    -- ── Resolution evidence ────────────────────────────────────────────────
    CREATE TABLE problem_bin_resolution_events (
      shop_id integer NOT NULL REFERENCES shops(id),
      device_event_id uuid NOT NULL,
      resolution_id uuid NOT NULL,
      problem_task_id uuid NOT NULL REFERENCES problem_center_tasks(problem_task_id),
      lasyncro_unit_id varchar(20) NOT NULL,
      outcome varchar(20) NOT NULL CHECK (outcome IN ('released', 'written_off')),
      problem_bin_location varchar(255) NOT NULL,
      problem_bin_scan varchar(255) NOT NULL,
      unit_scan varchar(255) NOT NULL,
      destination_location varchar(255) NULL,
      destination_scan varchar(255) NULL,
      write_off_reason varchar(20) NULL CHECK (write_off_reason IS NULL OR write_off_reason IN ('damaged', 'defective')),
      authority varchar(20) NOT NULL CHECK (authority IN ('management', 'problem_solver')),
      operator_id integer NOT NULL REFERENCES users(id),
      notes text NULL,
      result jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, device_event_id),
      UNIQUE (shop_id, problem_task_id),
      UNIQUE (shop_id, resolution_id),
      CHECK (unit_scan = lasyncro_unit_id),
      CHECK ((outcome = 'released') = (destination_location IS NOT NULL AND destination_scan IS NOT NULL)),
      CHECK (destination_location IS NULL OR destination_location <> problem_bin_location),
      CHECK ((outcome = 'written_off') = (write_off_reason IS NOT NULL)),
      CHECK (authority = 'management' OR outcome = 'released')
    );
    CREATE INDEX problem_bin_resolution_events_unit_idx ON problem_bin_resolution_events (shop_id, lasyncro_unit_id);
    ALTER TABLE problem_bin_resolution_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE problem_bin_resolution_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY problem_bin_resolution_events_tenant_isolation ON problem_bin_resolution_events
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
    REVOKE ALL ON problem_bin_resolution_events FROM sf_app;
    GRANT SELECT, INSERT ON problem_bin_resolution_events TO sf_app;

    CREATE FUNCTION prevent_problem_bin_resolution_event_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'problem_bin_resolution_events is append-only';
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER problem_bin_resolution_events_immutable BEFORE UPDATE OR DELETE ON problem_bin_resolution_events
      FOR EACH ROW EXECUTE FUNCTION prevent_problem_bin_resolution_event_mutation();

    -- An event must describe a real, open quarantine incident in custody, and
    -- problem-solver authority must be an active designation of an operator
    -- releasing a routine unit. Applies to every role: evidence is never forged.
    CREATE FUNCTION validate_problem_bin_resolution_event() RETURNS trigger AS $$
    DECLARE
      custody_reason varchar(20);
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM problem_center_tasks t
          JOIN inventory_units u ON u.shop_id = t.shop_id AND u.lasyncro_unit_id = t.lasyncro_unit_id
         WHERE t.shop_id = NEW.shop_id AND t.problem_task_id = NEW.problem_task_id
           AND t.source::text = 'warehouse' AND t.exception_type = 'quarantined_unit'
           AND t.status IN ('open', 'investigating')
           AND t.lasyncro_unit_id = NEW.lasyncro_unit_id
           AND t.problem_bin_location = NEW.problem_bin_location
           AND u.status::text = 'quarantined'
           AND u.current_location_code = NEW.problem_bin_location) THEN
        RAISE EXCEPTION 'PROBLEM_BIN_RESOLUTION_INVALID: % is not an open quarantine of % in %',
          NEW.problem_task_id, NEW.lasyncro_unit_id, NEW.problem_bin_location USING ERRCODE = 'P0001';
      END IF;
      SELECT e.quarantine_reason INTO custody_reason FROM problem_bin_custody_events e
       WHERE e.shop_id = NEW.shop_id AND e.problem_task_id = NEW.problem_task_id
         AND e.lasyncro_unit_id = NEW.lasyncro_unit_id AND e.problem_bin_location = NEW.problem_bin_location;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PROBLEM_BIN_RESOLUTION_INVALID: % has no custody event', NEW.problem_task_id
          USING ERRCODE = 'P0001';
      END IF;
      IF NEW.authority = 'problem_solver' AND (
           custody_reason IS DISTINCT FROM 'routine'
           OR NOT EXISTS (
             SELECT 1 FROM problem_solver_designations d
               JOIN shop_memberships m ON m.shop_id = d.shop_id AND m.user_id = d.user_id
              WHERE d.shop_id = NEW.shop_id AND d.user_id = NEW.operator_id AND d.revoked_at IS NULL
                AND m.revoked_at IS NULL AND m.role::text = 'operator')) THEN
        RAISE EXCEPTION 'PROBLEM_BIN_RESOLUTION_UNAUTHORIZED: % is not a designated problem solver for a routine unit',
          NEW.operator_id USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER problem_bin_resolution_events_validate BEFORE INSERT ON problem_bin_resolution_events
      FOR EACH ROW EXECUTE FUNCTION validate_problem_bin_resolution_event();

    -- ── Unit custody guard: 0231 rules + the two resolution exits ──────────
    CREATE OR REPLACE FUNCTION guard_problem_bin_unit_custody() RETURNS trigger AS $$
    BEGIN
      IF session_user <> 'sf_app' THEN
        RETURN NEW;
      END IF;
      IF OLD.status::text = 'quarantined' THEN
        IF NEW.status IS NOT DISTINCT FROM OLD.status
           AND NEW.current_location_code IS NOT DISTINCT FROM OLD.current_location_code
           AND NEW.quarantined_from_location IS NOT DISTINCT FROM OLD.quarantined_from_location
           AND NEW.quarantined_from_status IS NOT DISTINCT FROM OLD.quarantined_from_status THEN
          RETURN NEW;
        END IF;
        IF NEW.quarantined_from_location IS NULL AND NEW.quarantined_from_status IS NULL
           AND EXISTS (
             SELECT 1 FROM problem_bin_resolution_events r
               JOIN problem_center_tasks t
                 ON t.shop_id = r.shop_id AND t.problem_task_id = r.problem_task_id
              WHERE r.shop_id = OLD.shop_id AND r.lasyncro_unit_id = OLD.lasyncro_unit_id
                AND r.problem_bin_location = OLD.current_location_code
                AND t.status IN ('open', 'investigating')
                AND ((r.outcome = 'released' AND NEW.status::text = 'stowed'
                      AND NEW.current_location_code = r.destination_location)
                  OR (r.outcome = 'written_off' AND NEW.status::text = 'written_off'
                      AND NEW.current_location_code IS NULL))) THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'PROBLEM_BIN_CUSTODY_IMMUTABLE: % custody cannot change without its resolution event', OLD.lasyncro_unit_id
          USING ERRCODE = 'P0001';
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

    -- ── 0227 Receive closure rule, scoped to Receive unit tasks ────────────
    -- It was written for Receive unit tasks but matched every task carrying an
    -- LSU, which made 0231 quarantine incidents unclosable.
    CREATE OR REPLACE FUNCTION guard_receive_task_custody()
    RETURNS trigger AS $$
    DECLARE
      custody_location varchar(255);
    BEGIN
      IF session_user <> 'sf_app' THEN
        RETURN NEW;
      END IF;
      IF OLD.lasyncro_unit_id IS NULL AND NEW.lasyncro_unit_id IS NULL THEN
        RETURN NEW;
      END IF;
      IF NEW.shop_id IS DISTINCT FROM OLD.shop_id
         OR NEW.source IS DISTINCT FROM OLD.source
         OR NEW.lasyncro_unit_id IS DISTINCT FROM OLD.lasyncro_unit_id THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_IMMUTABLE: task % unit identity is fixed', OLD.problem_task_id
          USING ERRCODE = 'P0001';
      END IF;

      -- 0227: a Receive unit task closes only with its outcome event; closed is final.
      -- 0232: scoped to Receive unit tasks, as stated above. A Problem Bin
      -- quarantine incident (source 'warehouse') closes under its own 0232 guard.
      IF OLD.source::text = 'receive' AND NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status::text NOT IN ('open', 'investigating') THEN
          RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_TASK_FINAL: task % is already closed', OLD.problem_task_id
            USING ERRCODE = 'P0001';
        END IF;
        IF NEW.status::text NOT IN ('open', 'investigating') AND NOT EXISTS (
          SELECT 1 FROM receive_held_recovery_events
           WHERE shop_id = OLD.shop_id AND problem_task_id = OLD.problem_task_id
        ) THEN
          RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_OUTCOME_REQUIRED: task % has no recovery outcome', OLD.problem_task_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;

      IF NEW.problem_bin_location IS NOT DISTINCT FROM OLD.problem_bin_location THEN
        RETURN NEW;
      END IF;

      SELECT location_code INTO custody_location FROM receive_held_custody_events
       WHERE shop_id = OLD.shop_id AND problem_task_id = OLD.problem_task_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_EVENT_REQUIRED: task % has no custody event', OLD.problem_task_id
          USING ERRCODE = 'P0001';
      END IF;
      IF OLD.problem_bin_location IS NULL AND NEW.problem_bin_location = custody_location THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_IMMUTABLE: task % bin cannot change', OLD.problem_task_id
        USING ERRCODE = 'P0001';
    END;
    $$ LANGUAGE plpgsql;

    -- ── Incident guard: a quarantine incident closes only with its event ───
    CREATE FUNCTION guard_problem_bin_incident_closure() RETURNS trigger AS $$
    BEGIN
      IF session_user <> 'sf_app' OR OLD.exception_type IS DISTINCT FROM 'quarantined_unit' THEN
        RETURN NEW;
      END IF;
      IF OLD.status NOT IN ('open', 'investigating') THEN
        IF NEW.status IS DISTINCT FROM OLD.status
           OR NEW.resolution_action IS DISTINCT FROM OLD.resolution_action THEN
          RAISE EXCEPTION 'PROBLEM_BIN_INCIDENT_FINAL: % is closed', OLD.problem_task_id USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END IF;
      IF NEW.status NOT IN ('open', 'investigating') AND NOT EXISTS (
        SELECT 1 FROM problem_bin_resolution_events r
         WHERE r.shop_id = OLD.shop_id AND r.problem_task_id = OLD.problem_task_id
           AND NEW.status::text = 'resolved'
           AND NEW.resolution_action = CASE r.outcome WHEN 'released' THEN 'release_to_stock' ELSE 'write_off' END) THEN
        RAISE EXCEPTION 'PROBLEM_BIN_RESOLUTION_REQUIRED: % closes only with its resolution event', OLD.problem_task_id
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER problem_center_tasks_guard_problem_bin_closure BEFORE UPDATE ON problem_center_tasks
      FOR EACH ROW EXECUTE FUNCTION guard_problem_bin_incident_closure();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`LOCK TABLE problem_bin_resolution_events, problem_solver_designations, problem_bin_custody_events,
    inventory_units, problem_center_tasks IN ACCESS EXCLUSIVE MODE`);
  await knex.raw(`SET LOCAL row_security = off`);
  const result = await knex.raw(`SELECT EXISTS (SELECT 1 FROM problem_bin_resolution_events)
    OR EXISTS (SELECT 1 FROM problem_solver_designations)
    OR EXISTS (SELECT 1 FROM problem_bin_custody_events WHERE quarantine_reason IS NOT NULL)
    OR EXISTS (SELECT 1 FROM inventory_units WHERE status::text = 'written_off') AS used`);
  if (result.rows[0].used) throw new Error('PROBLEM_BIN_RESOLUTION_ROLLBACK_BLOCKED');
  await knex.raw(`
    DROP TRIGGER problem_center_tasks_guard_problem_bin_closure ON problem_center_tasks;
    DROP FUNCTION guard_problem_bin_incident_closure();
    ${GUARD_0231}
    ${GUARD_RECEIVE_TASK_0227}
    DROP TABLE problem_bin_resolution_events;
    DROP FUNCTION validate_problem_bin_resolution_event();
    DROP FUNCTION prevent_problem_bin_resolution_event_mutation();
    DROP TABLE problem_solver_designations;
    DROP FUNCTION guard_problem_solver_designation();
    ALTER TABLE problem_bin_custody_events DROP CONSTRAINT problem_bin_custody_events_reason_check;
    ALTER TABLE problem_bin_custody_events DROP COLUMN quarantine_reason;`);
  // The 'written_off' enum label remains (0224/0231 precedent). No evidence is removed.
}
