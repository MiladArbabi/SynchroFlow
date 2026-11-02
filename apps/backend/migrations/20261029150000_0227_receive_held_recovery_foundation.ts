import type { Knex } from 'knex';

/** S8-C5 / S4-5-I1 — durable recovery evidence for held Receive units.
 *
 * A held LSU in confirmed problem-bin custody (0226) leaves custody exactly
 * once, through receive_held_recovery_events — the append-only record of its
 * terminal outcome (precedent: 0226):
 *
 *   recovered   the unit is stowed by its receive_recovery Stow task.
 *   discarded   the unit is disposed of where it is; nothing is credited.
 *
 *   (shop_id, device_event_id)   strict replay authority.
 *   (shop_id, lasyncro_unit_id)  one terminal outcome per held LSU.
 *   (shop_id, problem_task_id)   one terminal outcome per Receive unit task.
 *
 * An outcome is accepted only for a closed Receive whose unit is held, placed,
 * and agrees with its 0226 custody event and task. Guards make the event the
 * ONLY authority for leaving custody for the runtime role:
 *
 *   inventory_units      placed held → stowed at the recovered event's bin,
 *                        or → discarded in place; a recovered unit then
 *                        follows the ordinary stock lifecycle (custody history
 *                        stays fixed); a discarded unit stays frozen.
 *   problem_center_tasks a Receive unit task reaches a terminal status only
 *                        with an outcome event; terminal is final.
 *   stow_tasks           receive_recovery: one live task per Receive unit task,
 *                        quantity 1, born pending from a closed, placed held
 *                        unit; its identity is immutable and it completes only
 *                        at its recovered event's bin.
 *
 * Task ↔ LSU identity is the existing problem_center_tasks.lasyncro_unit_id
 * (0224 unique, 0226 immutable) — stow_tasks gains no LSU column. 0224/0226
 * objects are referenced only from function bodies (no FK or index on them),
 * so their own DOWN migrations stay independent. Migration/owner roles keep
 * maintenance authority (session_user precedent: 0219/0220/0223/0226).
 * Inventory credit is untouched: no movement or truth object is read or written.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TYPE receive_held_recovery_outcome AS ENUM ('recovered', 'discarded');

    CREATE TABLE receive_held_recovery_events (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      device_event_id uuid NOT NULL,
      lasyncro_unit_id varchar(20) NOT NULL,
      -- Validated by trigger, not FK: an FK through 0226's composite task index
      -- would make 0226's own DOWN impossible.
      problem_task_id uuid NOT NULL,
      outcome receive_held_recovery_outcome NOT NULL,
      stow_task_id uuid NULL REFERENCES stow_tasks (stow_task_id) ON DELETE RESTRICT,
      location_code varchar(255) NOT NULL,
      -- Actor provenance without an FK: an append-only row cannot be SET NULL.
      recorded_by integer NULL,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, device_event_id),
      CONSTRAINT receive_held_recovery_events_unit_unique UNIQUE (shop_id, lasyncro_unit_id),
      CONSTRAINT receive_held_recovery_events_task_unique UNIQUE (shop_id, problem_task_id),
      CONSTRAINT receive_held_recovery_events_stow_shape CHECK (
        (outcome = 'recovered') = (stow_task_id IS NOT NULL)
      ),
      CONSTRAINT receive_held_recovery_events_unit_fk
        FOREIGN KEY (shop_id, lasyncro_unit_id)
        REFERENCES inventory_units (shop_id, lasyncro_unit_id)
        ON DELETE RESTRICT,
      CONSTRAINT receive_held_recovery_events_location_fk
        FOREIGN KEY (shop_id, location_code)
        REFERENCES warehouse_locations (shop_id, location_code)
        ON DELETE RESTRICT
    );

    CREATE FUNCTION validate_receive_held_recovery_event()
    RETURNS trigger AS $$
    DECLARE
      unit record;
      custody_location varchar(255);
      job_status text;
      stow record;
    BEGIN
      SELECT status::text AS status, held_placed_at, current_location_code, receive_job_line_id, lasyncro_variant_id
        INTO unit FROM inventory_units
       WHERE shop_id = NEW.shop_id AND lasyncro_unit_id = NEW.lasyncro_unit_id;
      IF NOT FOUND OR unit.status <> 'held' OR unit.held_placed_at IS NULL OR unit.current_location_code IS NULL THEN
        RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_UNIT_INVALID: % is not a placed held unit', NEW.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;

      SELECT e.location_code INTO custody_location
        FROM receive_held_custody_events e
        JOIN problem_center_tasks t ON t.shop_id = e.shop_id AND t.problem_task_id = e.problem_task_id
       WHERE e.shop_id = NEW.shop_id AND e.lasyncro_unit_id = NEW.lasyncro_unit_id
         AND e.problem_task_id = NEW.problem_task_id
         AND e.location_code = unit.current_location_code
         AND t.source::text = 'receive' AND t.lasyncro_unit_id = NEW.lasyncro_unit_id
         AND t.problem_bin_location = e.location_code
         AND t.status::text IN ('open', 'investigating');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_CUSTODY_INVALID: % has no matching custody for task %', NEW.lasyncro_unit_id, NEW.problem_task_id
          USING ERRCODE = 'P0001';
      END IF;

      SELECT j.status::text INTO job_status
        FROM receive_job_lines l JOIN receive_jobs j ON j.receive_job_id = l.receive_job_id
       WHERE l.receive_job_line_id = unit.receive_job_line_id AND l.shop_id = NEW.shop_id AND j.shop_id = NEW.shop_id;
      IF job_status IS DISTINCT FROM 'closed' THEN
        RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_RECEIVE_NOT_CLOSED: % belongs to a Receive that is not closed', NEW.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;

      IF NEW.outcome = 'recovered' THEN
        SELECT shop_id, status::text AS status, location_code, quantity, lasyncro_variant_id INTO stow
          FROM stow_tasks
         WHERE stow_task_id = NEW.stow_task_id AND trigger::text = 'receive_recovery'
           AND source_task_id = NEW.problem_task_id;
        IF NOT FOUND OR stow.shop_id <> NEW.shop_id OR stow.status <> 'in_progress' OR stow.quantity <> 1
           OR stow.lasyncro_variant_id <> unit.lasyncro_variant_id
           OR stow.location_code IS DISTINCT FROM NEW.location_code
           OR NEW.location_code = custody_location THEN
          RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_STOW_INVALID: % is not the in-progress recovery Stow of task % at %', NEW.stow_task_id, NEW.problem_task_id, NEW.location_code
            USING ERRCODE = 'P0001';
        END IF;
      ELSE
        IF NEW.location_code <> custody_location THEN
          RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_DISCARD_LOCATION_INVALID: % is discarded where it is held (%)', NEW.lasyncro_unit_id, custody_location
            USING ERRCODE = 'P0001';
        END IF;
        IF EXISTS (
          SELECT 1 FROM stow_tasks
           WHERE shop_id = NEW.shop_id AND trigger::text = 'receive_recovery'
             AND source_task_id = NEW.problem_task_id AND status::text <> 'cancelled'
        ) THEN
          RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_STOW_ACTIVE: task % has a live recovery Stow', NEW.problem_task_id
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER receive_held_recovery_events_validate
      BEFORE INSERT ON receive_held_recovery_events
      FOR EACH ROW EXECUTE FUNCTION validate_receive_held_recovery_event();

    CREATE FUNCTION prevent_receive_held_recovery_event_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'receive_held_recovery_events is append-only. % is not allowed.', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER receive_held_recovery_events_no_update
      BEFORE UPDATE ON receive_held_recovery_events
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_held_recovery_event_mutation();
    CREATE TRIGGER receive_held_recovery_events_no_delete
      BEFORE DELETE ON receive_held_recovery_events
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_held_recovery_event_mutation();

    ALTER TABLE receive_held_recovery_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE receive_held_recovery_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY receive_held_recovery_events_tenant_isolation_policy
      ON receive_held_recovery_events
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);

    -- The schema default ACL would otherwise hand sf_app UPDATE/DELETE (0211 lesson).
    REVOKE ALL ON receive_held_recovery_events FROM sf_app;
    GRANT SELECT, INSERT ON receive_held_recovery_events TO sf_app;

    -- One live recovery Stow per Receive unit task. Cancelled tasks are history.
    CREATE UNIQUE INDEX stow_tasks_receive_recovery_task_unique
      ON stow_tasks (shop_id, source_task_id)
      WHERE trigger = 'receive_recovery' AND status <> 'cancelled';

    CREATE FUNCTION guard_receive_recovery_stow()
    RETURNS trigger AS $$
    DECLARE
      task record;
      unit record;
      custody_location varchar(255);
      job_status text;
      recovered_location varchar(255);
      has_outcome boolean;
    BEGIN
      IF session_user <> 'sf_app' THEN
        RETURN NEW;
      END IF;

      IF TG_OP = 'UPDATE' THEN
        IF OLD.trigger::text <> 'receive_recovery' AND NEW.trigger::text <> 'receive_recovery' THEN
          RETURN NEW;
        END IF;
        IF NEW.trigger IS DISTINCT FROM OLD.trigger OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
           OR NEW.source_task_id IS DISTINCT FROM OLD.source_task_id OR NEW.quantity IS DISTINCT FROM OLD.quantity
           OR NEW.lasyncro_variant_id IS DISTINCT FROM OLD.lasyncro_variant_id THEN
          RAISE EXCEPTION 'RECEIVE_RECOVERY_STOW_IMMUTABLE: recovery Stow % identity is fixed', OLD.stow_task_id
            USING ERRCODE = 'P0001';
        END IF;
        IF OLD.status::text IN ('completed', 'cancelled')
           AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.location_code IS DISTINCT FROM OLD.location_code) THEN
          RAISE EXCEPTION 'RECEIVE_RECOVERY_STOW_IMMUTABLE: recovery Stow % is final', OLD.stow_task_id
            USING ERRCODE = 'P0001';
        END IF;

        SELECT location_code INTO recovered_location FROM receive_held_recovery_events
         WHERE shop_id = OLD.shop_id AND stow_task_id = OLD.stow_task_id;
        has_outcome := FOUND;
        IF has_outcome
           AND (NEW.location_code IS DISTINCT FROM OLD.location_code OR NEW.status::text = 'cancelled') THEN
          RAISE EXCEPTION 'RECEIVE_RECOVERY_STOW_IMMUTABLE: recovery Stow % has a recorded outcome', OLD.stow_task_id
            USING ERRCODE = 'P0001';
        END IF;
        IF NEW.status::text = 'completed' AND OLD.status::text <> 'completed'
           AND (NOT has_outcome OR NEW.location_code IS DISTINCT FROM recovered_location) THEN
          RAISE EXCEPTION 'RECEIVE_RECOVERY_STOW_OUTCOME_REQUIRED: recovery Stow % completes only with its recovered event', OLD.stow_task_id
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END IF;

      IF NEW.trigger::text <> 'receive_recovery' THEN
        RETURN NEW;
      END IF;
      IF NEW.quantity IS DISTINCT FROM 1 OR NEW.source_task_id IS NULL OR NEW.status::text <> 'pending'
         OR COALESCE(NEW.quantity_placed, 0) <> 0 THEN
        RAISE EXCEPTION 'RECEIVE_RECOVERY_STOW_SOURCE_INVALID: a recovery Stow is one pending unit from a Receive task'
          USING ERRCODE = 'P0001';
      END IF;

      SELECT lasyncro_unit_id, status::text AS status, problem_bin_location INTO task
        FROM problem_center_tasks
       WHERE shop_id = NEW.shop_id AND problem_task_id = NEW.source_task_id AND source::text = 'receive';
      IF NOT FOUND OR task.lasyncro_unit_id IS NULL OR task.status NOT IN ('open', 'investigating') THEN
        RAISE EXCEPTION 'RECEIVE_RECOVERY_STOW_SOURCE_INVALID: % is not an open Receive unit task', NEW.source_task_id
          USING ERRCODE = 'P0001';
      END IF;

      SELECT status::text AS status, held_placed_at, current_location_code, receive_job_line_id, lasyncro_variant_id
        INTO unit FROM inventory_units
       WHERE shop_id = NEW.shop_id AND lasyncro_unit_id = task.lasyncro_unit_id;
      SELECT location_code INTO custody_location FROM receive_held_custody_events
       WHERE shop_id = NEW.shop_id AND lasyncro_unit_id = task.lasyncro_unit_id AND problem_task_id = NEW.source_task_id;
      IF unit.status IS DISTINCT FROM 'held' OR unit.held_placed_at IS NULL OR custody_location IS NULL
         OR unit.current_location_code IS DISTINCT FROM custody_location
         OR task.problem_bin_location IS DISTINCT FROM custody_location
         OR NEW.lasyncro_variant_id IS DISTINCT FROM unit.lasyncro_variant_id
         OR NEW.location_code = custody_location
         OR EXISTS (SELECT 1 FROM receive_held_recovery_events
                     WHERE shop_id = NEW.shop_id AND lasyncro_unit_id = task.lasyncro_unit_id) THEN
        RAISE EXCEPTION 'RECEIVE_RECOVERY_STOW_SOURCE_INVALID: % is not a placed held unit awaiting recovery', task.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;

      SELECT j.status::text INTO job_status
        FROM receive_job_lines l JOIN receive_jobs j ON j.receive_job_id = l.receive_job_id
       WHERE l.receive_job_line_id = unit.receive_job_line_id AND l.shop_id = NEW.shop_id AND j.shop_id = NEW.shop_id;
      IF job_status IS DISTINCT FROM 'closed' THEN
        RAISE EXCEPTION 'RECEIVE_HELD_RECOVERY_RECEIVE_NOT_CLOSED: % belongs to a Receive that is not closed', task.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER stow_tasks_guard_receive_recovery
      BEFORE INSERT OR UPDATE ON stow_tasks
      FOR EACH ROW EXECUTE FUNCTION guard_receive_recovery_stow();

    -- 0226 guards, extended with the event-authorized exits. Every transition
    -- 0226 accepted or refused is unchanged.
    CREATE OR REPLACE FUNCTION guard_held_unit_custody()
    RETURNS trigger AS $$
    DECLARE
      custody_location varchar(255);
      recovery record;
    BEGIN
      IF session_user <> 'sf_app' THEN
        RETURN NEW;
      END IF;
      IF OLD.status::text NOT IN ('held', 'discarded') AND OLD.held_placed_at IS NULL
         AND NEW.held_placed_at IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT location_code INTO custody_location FROM receive_held_custody_events
       WHERE shop_id = OLD.shop_id AND lasyncro_unit_id = OLD.lasyncro_unit_id;

      IF NOT FOUND THEN
        IF NEW.held_placed_at IS DISTINCT FROM OLD.held_placed_at
           OR (OLD.status::text = 'held' AND NEW.current_location_code IS DISTINCT FROM OLD.current_location_code) THEN
          RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_EVENT_REQUIRED: % has no custody event', OLD.lasyncro_unit_id
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END IF;

      IF NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.lasyncro_unit_id IS DISTINCT FROM OLD.lasyncro_unit_id THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_IMMUTABLE: % unit identity is fixed', OLD.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;
      IF OLD.held_placed_at IS NULL AND OLD.current_location_code IS NULL AND OLD.status::text = 'held'
         AND NEW.status::text = 'held' AND NEW.held_placed_at IS NOT NULL
         AND NEW.current_location_code = custody_location THEN
        RETURN NEW;
      END IF;

      -- 0227: the one exit from custody, authorized by the unit's outcome event.
      -- Custody history (held_placed_at) never changes.
      SELECT outcome::text AS outcome, location_code INTO recovery FROM receive_held_recovery_events
       WHERE shop_id = OLD.shop_id AND lasyncro_unit_id = OLD.lasyncro_unit_id;
      IF FOUND AND NEW.held_placed_at IS NOT DISTINCT FROM OLD.held_placed_at THEN
        IF recovery.outcome = 'recovered' AND OLD.status::text = 'held'
           AND NEW.status::text = 'stowed' AND NEW.current_location_code = recovery.location_code THEN
          RETURN NEW;
        END IF;
        IF recovery.outcome = 'discarded' AND OLD.status::text = 'held'
           AND NEW.status::text = 'discarded' AND NEW.current_location_code IS NOT DISTINCT FROM OLD.current_location_code THEN
          RETURN NEW;
        END IF;
        -- A recovered, stowed unit is ordinary stock: pick/stow/ship move it,
        -- but it can never re-enter held or discarded.
        IF recovery.outcome = 'recovered' AND OLD.status::text NOT IN ('held', 'discarded')
           AND NEW.status::text NOT IN ('held', 'discarded') THEN
          RETURN NEW;
        END IF;
      END IF;

      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.current_location_code IS DISTINCT FROM OLD.current_location_code
         OR NEW.held_placed_at IS DISTINCT FROM OLD.held_placed_at THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_IMMUTABLE: % custody cannot change', OLD.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

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
    $$ LANGUAGE plpgsql;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Same fail-closed rollback contract as 0224/0226: persisted recovery
  // evidence wins over rollback convenience. Lock first so no evidence can be
  // written between the check and schema removal.
  await knex.raw(`
    LOCK TABLE receive_held_recovery_events, stow_tasks, inventory_units, problem_center_tasks
      IN ACCESS EXCLUSIVE MODE
  `);
  await knex.raw(`SET LOCAL row_security = off`);
  const result = await knex.raw(`
    SELECT (
      EXISTS (SELECT 1 FROM receive_held_recovery_events)
      OR EXISTS (SELECT 1 FROM stow_tasks WHERE trigger::text = 'receive_recovery' AND source_task_id IS NOT NULL)
    ) AS has_evidence
  `);
  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[RECEIVE_HELD_RECOVERY_ROLLBACK_BLOCKED] persisted held recovery evidence exists; 0227 cannot be removed'
    );
  }

  // Restore the exact 0226 guard bodies before removing what they now reference.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION guard_held_unit_custody()
    RETURNS trigger AS $$
    DECLARE
      custody_location varchar(255);
    BEGIN
      IF session_user <> 'sf_app' THEN
        RETURN NEW;
      END IF;
      -- Only held / custody-bearing units are guarded; every other unit
      -- update (pick, stow, labels on accepted stock) passes untouched.
      IF OLD.status::text NOT IN ('held', 'discarded') AND OLD.held_placed_at IS NULL
         AND NEW.held_placed_at IS NULL THEN
        RETURN NEW;
      END IF;

      SELECT location_code INTO custody_location FROM receive_held_custody_events
       WHERE shop_id = OLD.shop_id AND lasyncro_unit_id = OLD.lasyncro_unit_id;

      IF NOT FOUND THEN
        -- No custody evidence: custody may not be declared by a bare UPDATE.
        IF NEW.held_placed_at IS DISTINCT FROM OLD.held_placed_at
           OR (OLD.status::text = 'held' AND NEW.current_location_code IS DISTINCT FROM OLD.current_location_code) THEN
          RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_EVENT_REQUIRED: % has no custody event', OLD.lasyncro_unit_id
            USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END IF;

      IF NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.lasyncro_unit_id IS DISTINCT FROM OLD.lasyncro_unit_id THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_IMMUTABLE: % unit identity is fixed', OLD.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;
      -- The one placement transition: unplaced held → held at the event's bin.
      IF OLD.held_placed_at IS NULL AND OLD.current_location_code IS NULL AND OLD.status::text = 'held'
         AND NEW.status::text = 'held' AND NEW.held_placed_at IS NOT NULL
         AND NEW.current_location_code = custody_location THEN
        RETURN NEW;
      END IF;
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.current_location_code IS DISTINCT FROM OLD.current_location_code
         OR NEW.held_placed_at IS DISTINCT FROM OLD.held_placed_at THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_IMMUTABLE: % custody cannot change', OLD.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

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

    DROP TRIGGER stow_tasks_guard_receive_recovery ON stow_tasks;
    DROP FUNCTION guard_receive_recovery_stow();
    DROP INDEX stow_tasks_receive_recovery_task_unique;
    DROP TABLE receive_held_recovery_events;
    DROP FUNCTION prevent_receive_held_recovery_event_mutation();
    DROP FUNCTION validate_receive_held_recovery_event();
    DROP TYPE receive_held_recovery_outcome;
  `);
}
