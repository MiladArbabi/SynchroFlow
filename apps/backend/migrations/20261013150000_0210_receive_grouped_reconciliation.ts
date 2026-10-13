import type { Knex } from 'knex';

/** GH-1241 / S3-B. Additive, append-only grouped Receive reconciliation evidence.
 *
 * receive_reconciliation_revisions          draft revisions; a revision is superseded
 *                                           by the one naming it as base (linear chain).
 * receive_reconciliation_finalizations      at most one immutable finalization per job,
 *                                           bound to one revision and one device event.
 * receive_reconciliation_finalization_lines the finalized per-line allocation with its
 *                                           S3-A1 count provenance; a line finalizes once.
 * receive_reconciliation_exception_links    canonical receive_exceptions created by, or
 *                                           explicitly referenced by, the finalization.
 *
 * No backfill: existing jobs have no grouped evidence and unknown legacy
 * quantities stay unknown. Every row is append-only (precedent: 0209
 * receive_count_confirmation_events); corrections belong to a future
 * compensating workflow, never UPDATE/DELETE.
 */
const TABLES = [
  'receive_reconciliation_revisions',
  'receive_reconciliation_finalizations',
  'receive_reconciliation_finalization_lines',
  'receive_reconciliation_exception_links',
];

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    -- Tenant-scoped FK targets (both columns are already unique via the primary key).
    ALTER TABLE receive_jobs ADD CONSTRAINT receive_jobs_shop_job_unique UNIQUE (shop_id, receive_job_id);
    ALTER TABLE receive_exceptions ADD CONSTRAINT receive_exceptions_shop_exception_unique
      UNIQUE (shop_id, receive_exception_id);
    -- Owned here (not 0209's receive_job_lines_shop_line_unique) so earlier rollbacks stay independent;
    -- it also binds every finalized line to its own job.
    ALTER TABLE receive_job_lines ADD CONSTRAINT receive_job_lines_shop_job_line_unique
      UNIQUE (shop_id, receive_job_id, receive_job_line_id);

    CREATE TABLE receive_reconciliation_revisions (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      revision_id uuid NOT NULL DEFAULT gen_random_uuid(),
      receive_job_id uuid NOT NULL,
      revision_number integer NOT NULL CHECK (revision_number >= 1),
      base_revision_id uuid NULL,
      device_event_id uuid NOT NULL,
      payload jsonb NOT NULL,
      payload_hash text NOT NULL,
      -- Actor provenance without an FK: an append-only row cannot be SET NULL.
      created_by integer NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, revision_id),
      CONSTRAINT receive_reconciliation_revisions_job_revision_unique UNIQUE (shop_id, receive_job_id, revision_id),
      CONSTRAINT receive_reconciliation_revisions_number_unique UNIQUE (shop_id, receive_job_id, revision_number),
      CONSTRAINT receive_reconciliation_revisions_event_unique UNIQUE (shop_id, device_event_id),
      CONSTRAINT receive_reconciliation_revisions_base_valid CHECK ((revision_number = 1) = (base_revision_id IS NULL)),
      CONSTRAINT receive_reconciliation_revisions_job_fk
        FOREIGN KEY (shop_id, receive_job_id) REFERENCES receive_jobs (shop_id, receive_job_id) ON DELETE RESTRICT,
      CONSTRAINT receive_reconciliation_revisions_base_fk
        FOREIGN KEY (shop_id, receive_job_id, base_revision_id)
        REFERENCES receive_reconciliation_revisions (shop_id, receive_job_id, revision_id) ON DELETE RESTRICT
    );
    -- A revision has at most one successor: concurrent amendments of one base cannot both win.
    CREATE UNIQUE INDEX receive_reconciliation_revisions_successor_unique
      ON receive_reconciliation_revisions (shop_id, base_revision_id) WHERE base_revision_id IS NOT NULL;

    CREATE TABLE receive_reconciliation_finalizations (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      reconciliation_id uuid NOT NULL DEFAULT gen_random_uuid(),
      receive_job_id uuid NOT NULL,
      po_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      device_event_id uuid NOT NULL,
      payload_hash text NOT NULL,
      finalized_by integer NULL,
      finalized_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, reconciliation_id),
      CONSTRAINT receive_reconciliation_finalizations_job_unique UNIQUE (shop_id, receive_job_id),
      CONSTRAINT receive_reconciliation_finalizations_job_reconciliation_unique
        UNIQUE (shop_id, receive_job_id, reconciliation_id),
      CONSTRAINT receive_reconciliation_finalizations_event_unique UNIQUE (shop_id, device_event_id),
      CONSTRAINT receive_reconciliation_finalizations_job_fk
        FOREIGN KEY (shop_id, receive_job_id) REFERENCES receive_jobs (shop_id, receive_job_id) ON DELETE RESTRICT,
      CONSTRAINT receive_reconciliation_finalizations_revision_fk
        FOREIGN KEY (shop_id, receive_job_id, revision_id)
        REFERENCES receive_reconciliation_revisions (shop_id, receive_job_id, revision_id) ON DELETE RESTRICT
    );

    CREATE TABLE receive_reconciliation_finalization_lines (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      reconciliation_id uuid NOT NULL,
      receive_job_id uuid NOT NULL,
      receive_job_line_id uuid NOT NULL,
      quantity_expected integer NOT NULL CHECK (quantity_expected > 0),
      quantity_count_confirmed integer NOT NULL CHECK (quantity_count_confirmed >= 0),
      count_confirmation_event_id uuid NOT NULL,
      quantity_accepted integer NOT NULL CHECK (quantity_accepted >= 0),
      quantity_rejected integer NOT NULL CHECK (quantity_rejected >= 0),
      quantity_missing integer NOT NULL CHECK (quantity_missing >= 0),
      quantity_deferred integer NOT NULL CHECK (quantity_deferred >= 0),
      quantity_overage_approved integer NOT NULL CHECK (quantity_overage_approved >= 0),
      PRIMARY KEY (shop_id, receive_job_line_id),
      CONSTRAINT receive_reconciliation_finalization_lines_count_basis
        CHECK (quantity_accepted = quantity_count_confirmed),
      CONSTRAINT receive_reconciliation_finalization_lines_balanced CHECK (
        quantity_accepted + quantity_rejected + quantity_missing + quantity_deferred
          = quantity_expected + quantity_overage_approved
      ),
      CONSTRAINT receive_reconciliation_finalization_lines_finalization_fk
        FOREIGN KEY (shop_id, receive_job_id, reconciliation_id)
        REFERENCES receive_reconciliation_finalizations (shop_id, receive_job_id, reconciliation_id) ON DELETE RESTRICT,
      CONSTRAINT receive_reconciliation_finalization_lines_line_fk
        FOREIGN KEY (shop_id, receive_job_id, receive_job_line_id)
        REFERENCES receive_job_lines (shop_id, receive_job_id, receive_job_line_id) ON DELETE RESTRICT
    );
    CREATE INDEX receive_reconciliation_finalization_lines_reconciliation_idx
      ON receive_reconciliation_finalization_lines (shop_id, reconciliation_id);

    CREATE TABLE receive_reconciliation_exception_links (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      receive_exception_id uuid NOT NULL,
      reconciliation_id uuid NOT NULL,
      receive_job_line_id uuid NOT NULL,
      link_kind text NOT NULL CHECK (link_kind IN ('created', 'referenced')),
      PRIMARY KEY (shop_id, receive_exception_id),
      CONSTRAINT receive_reconciliation_exception_links_exception_fk
        FOREIGN KEY (shop_id, receive_exception_id)
        REFERENCES receive_exceptions (shop_id, receive_exception_id) ON DELETE RESTRICT,
      CONSTRAINT receive_reconciliation_exception_links_line_fk
        FOREIGN KEY (shop_id, receive_job_line_id)
        REFERENCES receive_reconciliation_finalization_lines (shop_id, receive_job_line_id) ON DELETE RESTRICT,
      CONSTRAINT receive_reconciliation_exception_links_finalization_fk
        FOREIGN KEY (shop_id, reconciliation_id)
        REFERENCES receive_reconciliation_finalizations (shop_id, reconciliation_id) ON DELETE RESTRICT
    );
    CREATE INDEX receive_reconciliation_exception_links_reconciliation_idx
      ON receive_reconciliation_exception_links (shop_id, reconciliation_id);

    CREATE FUNCTION prevent_receive_reconciliation_evidence_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '% is append-only. % is not allowed.', TG_TABLE_NAME, TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `);

  for (const table of TABLES) {
    await knex.raw(`
      CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION prevent_receive_reconciliation_evidence_mutation();
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION prevent_receive_reconciliation_evidence_mutation();
      ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
      CREATE POLICY ${table}_tenant_isolation_policy ON ${table}
        USING (shop_id = current_setting('app.current_tenant')::int)
        WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
      -- Default privileges would also hand the runtime role UPDATE/DELETE/TRUNCATE;
      -- evidence is append-only, and TRUNCATE would bypass the row triggers.
      REVOKE ALL ON ${table} FROM sf_app;
      GRANT SELECT, INSERT ON ${table} TO sf_app;
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  // Same fail-closed rollback contract as 0208/0209: persisted grouped
  // reconciliation evidence wins over rollback convenience. Lock first so no
  // evidence can be written between the check and schema removal.
  await knex.raw(`LOCK TABLE ${TABLES.join(', ')} IN ACCESS EXCLUSIVE MODE`);
  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT (${TABLES.map((t) => `EXISTS (SELECT 1 FROM ${t})`).join(' OR ')}) AS has_evidence
  `);
  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[RECEIVE_GROUPED_RECONCILIATION_ROLLBACK_BLOCKED] persisted grouped Receive reconciliation evidence exists; 0210 cannot be removed'
    );
  }

  await knex.raw(`
    DROP TABLE receive_reconciliation_exception_links;
    DROP TABLE receive_reconciliation_finalization_lines;
    DROP TABLE receive_reconciliation_finalizations;
    DROP TABLE receive_reconciliation_revisions;
    DROP FUNCTION prevent_receive_reconciliation_evidence_mutation();
    ALTER TABLE receive_job_lines DROP CONSTRAINT receive_job_lines_shop_job_line_unique;
    ALTER TABLE receive_exceptions DROP CONSTRAINT receive_exceptions_shop_exception_unique;
    ALTER TABLE receive_jobs DROP CONSTRAINT receive_jobs_shop_job_unique;
  `);
}
