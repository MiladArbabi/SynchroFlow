import type { Knex } from 'knex';

/** S8-C5 / S4-4 — durable custody evidence for recoverable held Receive units.
 *
 * A held LSU (0224 status 'held', minted by S4-3B) enters custody when an
 * operator places it in a problem bin. receive_held_custody_events is the
 * append-only record of that placement (precedent: 0209 / 0223 event tables):
 *
 *   (shop_id, device_event_id)   strict replay authority — one row per event.
 *   (shop_id, lasyncro_unit_id)  one placement per held LSU.
 *   (shop_id, problem_task_id)   one placement per Receive unit task.
 *
 * The event row is the custody authority. Guards make it the ONLY way custody
 * can be declared or changed for the runtime role:
 *
 *   inventory_units      a held unit gains held_placed_at / a location only by
 *                        the one transition matching its custody event; once
 *                        in custody its status, location and held_placed_at
 *                        are frozen.
 *   problem_center_tasks a Receive unit task's unit identity is immutable, and
 *                        its problem_bin_location is set only to its custody
 *                        event's bin, then frozen.
 *
 * Deliberately no recovery path: leaving custody (S4-5 Recovery) is refused
 * here until S4-5 separately authorizes those transitions. Bin suitability
 * (not pickable) stays a service check — pickableLocationCondition is a
 * tenant-dynamic predicate; the database proves the bin exists for the shop.
 *
 * Migration/owner roles keep maintenance authority (session_user precedent:
 * 0219/0220/0223). Inventory credit is untouched: no movement, truth or Stow
 * object is read or written.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Composite targets for tenant-safe FKs. Both columns are already unique
    -- on their own (inventory_units.lasyncro_unit_id, problem_task_id PK), so
    -- these can never reject an existing row.
    CREATE UNIQUE INDEX inventory_units_shop_unit_unique
      ON inventory_units (shop_id, lasyncro_unit_id);
    CREATE UNIQUE INDEX problem_center_tasks_shop_task_unique
      ON problem_center_tasks (shop_id, problem_task_id);

    CREATE TABLE receive_held_custody_events (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      device_event_id uuid NOT NULL,
      lasyncro_unit_id varchar(20) NOT NULL,
      problem_task_id uuid NOT NULL,
      location_code varchar(255) NOT NULL,
      -- Actor provenance without an FK: an append-only row cannot be SET NULL.
      placed_by integer NULL,
      placed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, device_event_id),
      CONSTRAINT receive_held_custody_events_unit_unique UNIQUE (shop_id, lasyncro_unit_id),
      CONSTRAINT receive_held_custody_events_task_unique UNIQUE (shop_id, problem_task_id),
      CONSTRAINT receive_held_custody_events_unit_fk
        FOREIGN KEY (shop_id, lasyncro_unit_id)
        REFERENCES inventory_units (shop_id, lasyncro_unit_id)
        ON DELETE RESTRICT,
      CONSTRAINT receive_held_custody_events_task_fk
        FOREIGN KEY (shop_id, problem_task_id)
        REFERENCES problem_center_tasks (shop_id, problem_task_id)
        ON DELETE RESTRICT,
      CONSTRAINT receive_held_custody_events_location_fk
        FOREIGN KEY (shop_id, location_code)
        REFERENCES warehouse_locations (shop_id, location_code)
        ON DELETE RESTRICT
    );

    -- Task ↔ unit agreement is checked here, not by an FK on
    -- problem_center_tasks.lasyncro_unit_id: that column belongs to 0224, and
    -- an FK on it would make 0224's own DOWN impossible.
    CREATE FUNCTION validate_receive_held_custody_event()
    RETURNS trigger AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM inventory_units
         WHERE shop_id = NEW.shop_id AND lasyncro_unit_id = NEW.lasyncro_unit_id
           AND status::text = 'held' AND held_placed_at IS NULL AND current_location_code IS NULL
      ) THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_UNIT_INVALID: % is not an unplaced held unit', NEW.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM problem_center_tasks
         WHERE shop_id = NEW.shop_id AND problem_task_id = NEW.problem_task_id
           AND source::text = 'receive' AND lasyncro_unit_id = NEW.lasyncro_unit_id
      ) THEN
        RAISE EXCEPTION 'RECEIVE_HELD_CUSTODY_TASK_INVALID: task % is not the Receive task of %', NEW.problem_task_id, NEW.lasyncro_unit_id
          USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER receive_held_custody_events_validate
      BEFORE INSERT ON receive_held_custody_events
      FOR EACH ROW EXECUTE FUNCTION validate_receive_held_custody_event();

    CREATE FUNCTION prevent_receive_held_custody_event_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'receive_held_custody_events is append-only. % is not allowed.', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER receive_held_custody_events_no_update
      BEFORE UPDATE ON receive_held_custody_events
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_held_custody_event_mutation();
    CREATE TRIGGER receive_held_custody_events_no_delete
      BEFORE DELETE ON receive_held_custody_events
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_held_custody_event_mutation();

    ALTER TABLE receive_held_custody_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE receive_held_custody_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY receive_held_custody_events_tenant_isolation_policy
      ON receive_held_custody_events
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
    -- The schema default ACL would otherwise hand sf_app UPDATE/DELETE (0211 lesson).
    REVOKE ALL ON receive_held_custody_events FROM sf_app;
    GRANT SELECT, INSERT ON receive_held_custody_events TO sf_app;

    CREATE FUNCTION guard_held_unit_custody()
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
    CREATE TRIGGER inventory_units_guard_held_custody
      BEFORE UPDATE ON inventory_units
      FOR EACH ROW EXECUTE FUNCTION guard_held_unit_custody();

    CREATE FUNCTION guard_receive_task_custody()
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
    CREATE TRIGGER problem_center_tasks_guard_receive_custody
      BEFORE UPDATE ON problem_center_tasks
      FOR EACH ROW EXECUTE FUNCTION guard_receive_task_custody();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Same fail-closed rollback contract as 0223/0224/0225: persisted custody
  // evidence wins over rollback convenience. Lock first so no evidence can be
  // written between the check and schema removal.
  await knex.raw(`
    LOCK TABLE receive_held_custody_events, inventory_units, problem_center_tasks
      IN ACCESS EXCLUSIVE MODE
  `);
  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT EXISTS (SELECT 1 FROM receive_held_custody_events) AS has_evidence
  `);
  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[RECEIVE_HELD_CUSTODY_ROLLBACK_BLOCKED] persisted held custody evidence exists; 0226 cannot be removed'
    );
  }

  await knex.raw(`
    DROP TRIGGER problem_center_tasks_guard_receive_custody ON problem_center_tasks;
    DROP FUNCTION guard_receive_task_custody();
    DROP TRIGGER inventory_units_guard_held_custody ON inventory_units;
    DROP FUNCTION guard_held_unit_custody();
    DROP TABLE receive_held_custody_events;
    DROP FUNCTION prevent_receive_held_custody_event_mutation();
    DROP FUNCTION validate_receive_held_custody_event();
    DROP INDEX problem_center_tasks_shop_task_unique;
    DROP INDEX inventory_units_shop_unit_unique;
  `);
}
