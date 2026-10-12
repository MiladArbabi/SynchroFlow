import type { Knex } from 'knex';

/** GH-1241 / S3-A1. Additive operator count-confirmation evidence.
 * NULL is "never physically confirmed". No backfill: provisional drafts,
 * accepted quantities and reconciliation markers are never evidence.
 *
 * receive_count_confirmation_events is the durable, append-only record that a
 * confirmation event ID was consumed (precedent: 0085 pick_scan_log, 0204
 * pick_scan_unit_lineage). A later draft edit may clear the line's ACTIVE
 * confirmation, but never this history, so a consumed event can never
 * restore invalidated evidence.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('receive_job_lines', (t) => {
    t.integer('quantity_count_confirmed').nullable();
    // Provenance FKs follow 0097/0099/0208: losing the actor never deletes the evidence.
    t.integer('count_confirmed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('count_confirmed_at', { useTz: true }).nullable();
    t.uuid('count_confirmation_event_id').nullable();
  });
  await knex.raw(`
    ALTER TABLE receive_job_lines ADD CONSTRAINT receive_count_confirmation_valid CHECK (
      (quantity_count_confirmed IS NULL AND count_confirmed_at IS NULL AND count_confirmation_event_id IS NULL)
      OR (quantity_count_confirmed >= 0 AND count_confirmed_at IS NOT NULL AND count_confirmation_event_id IS NOT NULL)
    );
    CREATE UNIQUE INDEX receive_count_confirmation_event_unique ON receive_job_lines (shop_id, count_confirmation_event_id)
      WHERE count_confirmation_event_id IS NOT NULL;

    ALTER TABLE receive_job_lines ADD CONSTRAINT receive_job_lines_shop_line_unique
      UNIQUE (shop_id, receive_job_line_id);

    CREATE TABLE receive_count_confirmation_events (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      event_id uuid NOT NULL,
      receive_job_line_id uuid NOT NULL,
      quantity_confirmed integer NOT NULL CHECK (quantity_confirmed >= 0),
      -- Actor provenance without an FK: an append-only row cannot be SET NULL.
      confirmed_by integer NULL,
      confirmed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, event_id),
      CONSTRAINT receive_count_confirmation_events_shop_line_fk
        FOREIGN KEY (shop_id, receive_job_line_id)
        REFERENCES receive_job_lines (shop_id, receive_job_line_id)
        ON DELETE RESTRICT
    );
    CREATE INDEX receive_count_confirmation_events_line_idx
      ON receive_count_confirmation_events (shop_id, receive_job_line_id);

    CREATE FUNCTION prevent_receive_count_confirmation_event_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'receive_count_confirmation_events is append-only. % is not allowed.', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER receive_count_confirmation_events_no_update
      BEFORE UPDATE ON receive_count_confirmation_events
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_count_confirmation_event_mutation();
    CREATE TRIGGER receive_count_confirmation_events_no_delete
      BEFORE DELETE ON receive_count_confirmation_events
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_count_confirmation_event_mutation();

    ALTER TABLE receive_count_confirmation_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE receive_count_confirmation_events FORCE ROW LEVEL SECURITY;
    CREATE POLICY receive_count_confirmation_events_tenant_isolation_policy
      ON receive_count_confirmation_events
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
    GRANT SELECT, INSERT ON receive_count_confirmation_events TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Same fail-closed rollback contract as 0208: persisted operator evidence
  // wins over rollback convenience.
  await knex.raw(`LOCK TABLE receive_job_lines, receive_count_confirmation_events IN ACCESS EXCLUSIVE MODE`);
  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT (
      EXISTS (SELECT 1 FROM receive_job_lines
               WHERE quantity_count_confirmed IS NOT NULL OR count_confirmed_by IS NOT NULL
                  OR count_confirmed_at IS NOT NULL OR count_confirmation_event_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM receive_count_confirmation_events)
    ) AS has_evidence
  `);

  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[RECEIVE_COUNT_CONFIRMATION_ROLLBACK_BLOCKED] persisted Receive count-confirmation evidence exists; 0209 cannot be removed'
    );
  }

  await knex.raw(`
    DROP TABLE receive_count_confirmation_events;
    ALTER TABLE receive_job_lines DROP CONSTRAINT receive_job_lines_shop_line_unique;
    DROP FUNCTION prevent_receive_count_confirmation_event_mutation();
    DROP INDEX receive_count_confirmation_event_unique;
    ALTER TABLE receive_job_lines DROP CONSTRAINT receive_count_confirmation_valid;
  `);
  await knex.schema.alterTable('receive_job_lines', (t) => {
    t.dropColumns('quantity_count_confirmed', 'count_confirmed_by', 'count_confirmed_at', 'count_confirmation_event_id');
  });
}
