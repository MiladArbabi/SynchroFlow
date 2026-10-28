import type { Knex } from 'knex';

/** S8-C5 / Receive Recount. Additive per-line Recount evidence.
 *
 * An operator who discovers a miscount after shortfall allocations were
 * persisted (but before inspection) recounts the line. The allocations are
 * SUPERSEDED, never deleted: receive_exceptions gains supersession provenance
 * and receive_line_recount_events is the durable, append-only record that a
 * Recount event ID was consumed (precedent: 0209 receive_count_confirmation_events).
 *
 * receive_exceptions evidence was previously immutable by convention only
 * (0105 default grants gave sf_app UPDATE/DELETE, no trigger). For the runtime
 * role this migration makes it enforced: DELETE/TRUNCATE are revoked, and an
 * UPDATE may only (a) supersede an active row once, or (b) clear actor
 * provenance (users FK ON DELETE SET NULL). Migration/owner roles keep
 * maintenance authority (session_user precedent: 0219/0220).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE receive_line_recount_events (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      event_id uuid NOT NULL,
      receive_job_id uuid NOT NULL,
      receive_job_line_id uuid NOT NULL,
      superseded_count integer NOT NULL CHECK (superseded_count >= 0),
      previous_quantity_count_confirmed integer NULL CHECK (previous_quantity_count_confirmed >= 0),
      previous_quantity_deferred integer NULL CHECK (previous_quantity_deferred >= 0),
      previous_quantity_sellable_provisional integer NULL CHECK (previous_quantity_sellable_provisional >= 0),
      -- Actor provenance without an FK: an append-only row cannot be SET NULL.
      recounted_by integer NULL,
      recounted_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, event_id),
      CONSTRAINT receive_line_recount_events_shop_job_line_fk
        FOREIGN KEY (shop_id, receive_job_id, receive_job_line_id)
        REFERENCES receive_job_lines (shop_id, receive_job_id, receive_job_line_id)
        ON DELETE RESTRICT
    );
    CREATE INDEX receive_line_recount_events_line_idx
      ON receive_line_recount_events (shop_id, receive_job_line_id);

    CREATE FUNCTION prevent_receive_line_recount_event_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'receive_line_recount_events is append-only. % is not allowed.', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER receive_line_recount_events_no_update
      BEFORE UPDATE ON receive_line_recount_events
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_line_recount_event_mutation();
    CREATE TRIGGER receive_line_recount_events_no_delete
      BEFORE DELETE ON receive_line_recount_events
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_line_recount_event_mutation();

    ALTER TABLE receive_line_recount_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE receive_line_recount_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY receive_line_recount_events_tenant_isolation_policy
      ON receive_line_recount_events
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
    -- The schema default ACL would otherwise hand sf_app UPDATE/DELETE (0211 lesson).
    REVOKE ALL ON receive_line_recount_events FROM sf_app;
    GRANT SELECT, INSERT ON receive_line_recount_events TO sf_app;

    ALTER TABLE receive_exceptions
      ADD COLUMN superseded_at timestamptz NULL,
      ADD COLUMN superseded_by integer NULL REFERENCES users (id) ON DELETE SET NULL,
      ADD COLUMN superseded_by_recount_event_id uuid NULL;
    ALTER TABLE receive_exceptions ADD CONSTRAINT receive_exceptions_supersession_valid CHECK (
      (superseded_at IS NULL AND superseded_by IS NULL AND superseded_by_recount_event_id IS NULL)
      OR (superseded_at IS NOT NULL AND superseded_by_recount_event_id IS NOT NULL)
    );
    ALTER TABLE receive_exceptions ADD CONSTRAINT receive_exceptions_superseding_recount_fk
      FOREIGN KEY (shop_id, superseded_by_recount_event_id)
      REFERENCES receive_line_recount_events (shop_id, event_id)
      ON DELETE RESTRICT;
    CREATE INDEX receive_exceptions_active_line_idx
      ON receive_exceptions (shop_id, receive_job_line_id) WHERE superseded_at IS NULL;

    -- pg_trigger_depth() > 1 is only trustworthy provenance while sf_app cannot
    -- create an object that nests an UPDATE inside its own trigger: no TEMP,
    -- no database/schema CREATE, no owned relation/function/schema, no TRIGGER
    -- grant, no role attribute or membership/ADMIN path to any of those
    -- (0215 precedent: catalog privilege functions, PUBLIC grants included).
    CREATE FUNCTION receive_exception_provenance_boundary_intact()
    RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
      SELECT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles r
         WHERE pg_catalog.pg_has_role('sf_app', r.oid, 'MEMBER')
           AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb
             OR pg_catalog.has_database_privilege(r.oid, pg_catalog.current_database(), 'CREATE,TEMPORARY')
             OR EXISTS (SELECT 1 FROM pg_catalog.pg_database d
                         WHERE d.datname = pg_catalog.current_database() AND d.datdba = r.oid)
             OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n
                         WHERE n.nspowner = r.oid OR pg_catalog.has_schema_privilege(r.oid, n.oid, 'CREATE'))
             OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                         WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
                           AND (c.relowner = r.oid OR pg_catalog.has_table_privilege(r.oid, c.oid, 'TRIGGER')))
             OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proowner = r.oid)
             OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid AND m.admin_option))
      )
    $$;
    DO $$
    BEGIN
      IF NOT receive_exception_provenance_boundary_intact() THEN
        RAISE EXCEPTION 'RECEIVE_PROVENANCE_AUTHORITY_INVALID';
      END IF;
    END
    $$;

    CREATE FUNCTION guard_receive_exception_mutation()
    RETURNS trigger AS $$
    BEGIN
      IF session_user <> 'sf_app' THEN
        RETURN NEW;
      END IF;
      -- (a) one-time supersession of an active row; every evidence column unchanged.
      IF OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL
         AND NEW.superseded_by_recount_event_id IS NOT NULL
         AND (to_jsonb(NEW) - ARRAY['superseded_at', 'superseded_by', 'superseded_by_recount_event_id', 'updated_at'])
           = (to_jsonb(OLD) - ARRAY['superseded_at', 'superseded_by', 'superseded_by_recount_event_id', 'updated_at']) THEN
        RETURN NEW;
      END IF;
      -- (b) actor provenance cleared by the users ON DELETE SET NULL action only;
      -- nothing else changes. That action runs from the RI trigger on users, so
      -- this guard is nested (depth > 1); a direct UPDATE is depth 1 and refused.
      -- Nesting is re-proven unforgeable here (rare path) so a later privilege
      -- regrant fails closed instead of reopening the bypass.
      IF pg_trigger_depth() > 1
         AND (NEW.raised_by IS NULL OR NEW.raised_by IS NOT DISTINCT FROM OLD.raised_by)
         AND (NEW.resolved_by IS NULL OR NEW.resolved_by IS NOT DISTINCT FROM OLD.resolved_by)
         AND (NEW.superseded_by IS NULL OR NEW.superseded_by IS NOT DISTINCT FROM OLD.superseded_by)
         AND (to_jsonb(NEW) - ARRAY['raised_by', 'resolved_by', 'superseded_by', 'updated_at'])
           = (to_jsonb(OLD) - ARRAY['raised_by', 'resolved_by', 'superseded_by', 'updated_at']) THEN
        IF receive_exception_provenance_boundary_intact() THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'RECEIVE_PROVENANCE_AUTHORITY_INVALID' USING ERRCODE = 'P0001';
      END IF;
      RAISE EXCEPTION 'receive_exceptions evidence is immutable; only a Recount may supersede an active row.'
        USING ERRCODE = 'P0001';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER receive_exceptions_guard_update
      BEFORE UPDATE ON receive_exceptions
      FOR EACH ROW EXECUTE FUNCTION guard_receive_exception_mutation();
    REVOKE DELETE, TRUNCATE ON receive_exceptions FROM sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Same fail-closed rollback contract as 0208/0209/0210: persisted operator
  // evidence wins over rollback convenience.
  await knex.raw(`LOCK TABLE receive_exceptions, receive_line_recount_events IN ACCESS EXCLUSIVE MODE`);
  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT (
      EXISTS (SELECT 1 FROM receive_exceptions
               WHERE superseded_at IS NOT NULL OR superseded_by IS NOT NULL OR superseded_by_recount_event_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM receive_line_recount_events)
    ) AS has_evidence
  `);

  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[RECEIVE_RECOUNT_ROLLBACK_BLOCKED] persisted Receive Recount evidence exists; 0223 cannot be removed'
    );
  }

  await knex.raw(`
    DROP TRIGGER receive_exceptions_guard_update ON receive_exceptions;
    DROP FUNCTION guard_receive_exception_mutation();
    DROP FUNCTION receive_exception_provenance_boundary_intact();
    DROP INDEX receive_exceptions_active_line_idx;
    ALTER TABLE receive_exceptions DROP CONSTRAINT receive_exceptions_superseding_recount_fk;
    ALTER TABLE receive_exceptions DROP CONSTRAINT receive_exceptions_supersession_valid;
    ALTER TABLE receive_exceptions
      DROP COLUMN superseded_by_recount_event_id,
      DROP COLUMN superseded_by,
      DROP COLUMN superseded_at;
    DROP TABLE receive_line_recount_events;
    DROP FUNCTION prevent_receive_line_recount_event_mutation();
  `);
  // Security is monotonic (0211): rolling back never re-grants DELETE/TRUNCATE.
}
