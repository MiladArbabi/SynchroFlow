import type { Knex } from 'knex';

/** GH-1254 / S4-B. Atomic held-unit capture for grouped Receive reconciliation.
 *
 * A recoverable product defect or packaging damage reported in a grouped
 * finalization becomes HELD units: one receive_held_captures row per
 * recoverable exception, one inventory unit per physical unit on that capture
 * (a third source anchor, never the Receive line of accepted stock), and one
 * Problem Center recovery task per unit.
 *
 * Provenance is enforced by composite foreign keys, not by the service:
 *   capture → finalization line (same reconciliation + job + line)
 *           → exception link    (exception CREATED by that reconciliation for that line)
 *           → exception         (same job, line, variant, type and held role)
 *           → receive line      (same variant) and warehouse (same shop)
 *   unit    → capture (same variant)
 *   task    → unit (same LSU, capture and variant) and capture (same warehouse and exception)
 *
 * Lifecycle protection: a held unit stays status 'held' with no location; a
 * held task never carries a copied problem bin. Accepted units can never be
 * 'held'. Captures are append-only (0210 precedent).
 *
 * The three CHECK replacements are the only non-additive statements:
 *   receive_delivery_disposition_valid  held may be > 0 (was = 0)
 *   ..._finalization_lines_balanced     includes held
 *   inventory_units_source_anchor_xor   exactly one of three anchors
 * Existing rows satisfy the replacements (held is 0/NULL; no third anchor).
 * New enum values are compared as ::text (0195 precedent): a value added in
 * this transaction cannot be used as an enum literal before commit.
 */
const CAPTURES = 'receive_held_captures';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TYPE inventory_unit_lifecycle_status ADD VALUE IF NOT EXISTS 'held';
    ALTER TYPE inventory_unit_provenance ADD VALUE IF NOT EXISTS 'receive_held_recoverable';
  `);

  await knex.raw(`
    -- Delivered includes held; held may now be positive.
    ALTER TABLE receive_job_lines DROP CONSTRAINT receive_delivery_disposition_valid;
    ALTER TABLE receive_job_lines ADD CONSTRAINT receive_delivery_disposition_valid CHECK (
      (quantity_delivered IS NULL OR quantity_delivered >= 0)
      AND (quantity_missing IS NULL OR quantity_missing >= 0)
      AND (quantity_deferred IS NULL OR quantity_deferred >= 0)
      AND (quantity_held_recoverable IS NULL OR quantity_held_recoverable >= 0)
      AND (quantity_delivered IS NULL OR (
        inspection_complete AND quantity_missing IS NOT NULL AND quantity_deferred IS NOT NULL
        AND quantity_held_recoverable IS NOT NULL AND quantity_accepted >= 0 AND quantity_rejected >= 0
        AND quantity_delivered = quantity_accepted + quantity_rejected + quantity_held_recoverable
        AND quantity_delivered + quantity_missing + quantity_deferred >= quantity_expected
      ))
    );

    -- The finalized allocation records held and balances with it.
    ALTER TABLE receive_reconciliation_finalization_lines
      ADD COLUMN quantity_held_recoverable integer NOT NULL DEFAULT 0
        CONSTRAINT receive_reconciliation_finalization_lines_held_nonnegative CHECK (quantity_held_recoverable >= 0);
    ALTER TABLE receive_reconciliation_finalization_lines DROP CONSTRAINT receive_reconciliation_finalization_lines_balanced;
    ALTER TABLE receive_reconciliation_finalization_lines ADD CONSTRAINT receive_reconciliation_finalization_lines_balanced CHECK (
      quantity_accepted + quantity_rejected + quantity_held_recoverable + quantity_missing + quantity_deferred
        = quantity_expected + quantity_overage_approved
    );

    -- Composite FK targets (supersets of existing keys; no row is rewritten).
    ALTER TABLE receive_reconciliation_finalization_lines ADD CONSTRAINT rrfl_held_target
      UNIQUE (shop_id, reconciliation_id, receive_job_id, receive_job_line_id);
    ALTER TABLE receive_reconciliation_exception_links ADD CONSTRAINT rrel_held_target
      UNIQUE (shop_id, receive_exception_id, reconciliation_id, receive_job_line_id, link_kind);
    ALTER TABLE receive_exceptions ADD CONSTRAINT receive_exceptions_held_target
      UNIQUE (shop_id, receive_exception_id, receive_job_id, receive_job_line_id, lasyncro_variant_id, exception_type, accounting_role);
    ALTER TABLE receive_job_lines ADD CONSTRAINT receive_job_lines_held_target
      UNIQUE (shop_id, receive_job_id, receive_job_line_id, lasyncro_variant_id);

    CREATE TABLE ${CAPTURES} (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      held_capture_id uuid NOT NULL DEFAULT gen_random_uuid(),
      reconciliation_id uuid NOT NULL,
      receive_job_id uuid NOT NULL,
      receive_job_line_id uuid NOT NULL,
      receive_exception_id uuid NOT NULL,
      link_kind text NOT NULL DEFAULT 'created' CHECK (link_kind = 'created'),
      lasyncro_variant_id uuid NOT NULL,
      exception_type receive_exception_type NOT NULL
        CHECK (exception_type::text IN ('defect', 'packaging_damage')),
      accounting_role text NOT NULL DEFAULT 'held_recoverable' CHECK (accounting_role = 'held_recoverable'),
      warehouse_id uuid NOT NULL,
      quantity_held integer NOT NULL CHECK (quantity_held > 0),
      -- Actor provenance without an FK: an append-only row cannot be SET NULL.
      created_by integer NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, held_capture_id),
      CONSTRAINT rhc_exception_unique UNIQUE (shop_id, receive_exception_id),
      CONSTRAINT rhc_unit_target UNIQUE (shop_id, held_capture_id, lasyncro_variant_id),
      CONSTRAINT rhc_task_target UNIQUE (shop_id, held_capture_id, lasyncro_variant_id, warehouse_id, receive_exception_id),
      CONSTRAINT rhc_finalization_line_fk FOREIGN KEY (shop_id, reconciliation_id, receive_job_id, receive_job_line_id)
        REFERENCES receive_reconciliation_finalization_lines (shop_id, reconciliation_id, receive_job_id, receive_job_line_id) ON DELETE RESTRICT,
      CONSTRAINT rhc_link_fk FOREIGN KEY (shop_id, receive_exception_id, reconciliation_id, receive_job_line_id, link_kind)
        REFERENCES receive_reconciliation_exception_links (shop_id, receive_exception_id, reconciliation_id, receive_job_line_id, link_kind) ON DELETE RESTRICT,
      CONSTRAINT rhc_exception_fk FOREIGN KEY (shop_id, receive_exception_id, receive_job_id, receive_job_line_id, lasyncro_variant_id, exception_type, accounting_role)
        REFERENCES receive_exceptions (shop_id, receive_exception_id, receive_job_id, receive_job_line_id, lasyncro_variant_id, exception_type, accounting_role) ON DELETE RESTRICT,
      CONSTRAINT rhc_line_fk FOREIGN KEY (shop_id, receive_job_id, receive_job_line_id, lasyncro_variant_id)
        REFERENCES receive_job_lines (shop_id, receive_job_id, receive_job_line_id, lasyncro_variant_id) ON DELETE RESTRICT,
      CONSTRAINT rhc_warehouse_fk FOREIGN KEY (shop_id, warehouse_id)
        REFERENCES warehouses (shop_id, warehouse_id) ON DELETE RESTRICT
    );
    CREATE INDEX rhc_job_idx ON ${CAPTURES} (shop_id, receive_job_id);
    CREATE TRIGGER ${CAPTURES}_no_update BEFORE UPDATE ON ${CAPTURES}
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_reconciliation_evidence_mutation();
    CREATE TRIGGER ${CAPTURES}_no_delete BEFORE DELETE ON ${CAPTURES}
      FOR EACH ROW EXECUTE FUNCTION prevent_receive_reconciliation_evidence_mutation();
    ALTER TABLE ${CAPTURES} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${CAPTURES} FORCE ROW LEVEL SECURITY;
    CREATE POLICY ${CAPTURES}_tenant_isolation_policy ON ${CAPTURES}
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
    -- Evidence is append-only; TRUNCATE would bypass the row triggers.
    REVOKE ALL ON ${CAPTURES} FROM sf_app;
    GRANT SELECT, INSERT ON ${CAPTURES} TO sf_app;

    -- Held units: a third source anchor, bound to its capture and variant.
    ALTER TABLE inventory_units ADD COLUMN receive_held_capture_id uuid NULL;
    ALTER TABLE inventory_units
      ADD CONSTRAINT inventory_units_held_capture_fk FOREIGN KEY (shop_id, receive_held_capture_id, lasyncro_variant_id)
        REFERENCES ${CAPTURES} (shop_id, held_capture_id, lasyncro_variant_id) ON DELETE RESTRICT,
      ADD CONSTRAINT inventory_units_held_sequence_unique UNIQUE (shop_id, receive_held_capture_id, receive_sequence),
      ADD CONSTRAINT inventory_units_held_task_target UNIQUE (shop_id, lasyncro_unit_id, receive_held_capture_id, lasyncro_variant_id);
    ALTER TABLE inventory_units DROP CONSTRAINT inventory_units_source_anchor_xor;
    ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_source_anchor_xor
      CHECK (num_nonnulls(receive_job_line_id, recount_line_id, receive_held_capture_id) = 1);
    ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_held_provenance_check
      CHECK ((receive_held_capture_id IS NOT NULL) = (source::text = 'receive_held_recoverable'));
    -- S4-B lock-in: a held unit cannot leave 'held' or gain a location, and no
    -- other unit can become 'held'. S4-E replaces this with a verified Stow transition.
    ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_held_state_check
      CHECK ((receive_held_capture_id IS NOT NULL) = (status::text = 'held')
             AND (receive_held_capture_id IS NULL OR current_location_code IS NULL));

    -- One recovery task per held LSU, bound to unit, capture, warehouse and exception.
    ALTER TABLE problem_center_tasks
      ADD COLUMN source_lasyncro_unit_id varchar(20) NULL,
      ADD COLUMN receive_held_capture_id uuid NULL,
      ADD COLUMN warehouse_id uuid NULL;
    ALTER TABLE problem_center_tasks
      ADD CONSTRAINT pct_held_unit_fk FOREIGN KEY (shop_id, source_lasyncro_unit_id, receive_held_capture_id, lasyncro_variant_id)
        REFERENCES inventory_units (shop_id, lasyncro_unit_id, receive_held_capture_id, lasyncro_variant_id) ON DELETE RESTRICT,
      ADD CONSTRAINT pct_held_capture_fk FOREIGN KEY (shop_id, receive_held_capture_id, lasyncro_variant_id, warehouse_id, source_exception_id)
        REFERENCES ${CAPTURES} (shop_id, held_capture_id, lasyncro_variant_id, warehouse_id, receive_exception_id) ON DELETE RESTRICT,
      -- MATCH SIMPLE skips a partially NULL key, so held columns are all-or-none
      -- and every held key column is required: both FKs are always fully checked.
      ADD CONSTRAINT pct_held_shape CHECK (
        num_nonnulls(source_lasyncro_unit_id, receive_held_capture_id, warehouse_id) = 0
        OR (num_nonnulls(source_lasyncro_unit_id, receive_held_capture_id, warehouse_id) = 3
            AND source::text = 'receive' AND source_exception_id IS NOT NULL
            AND source_pick_exception_id IS NULL AND quantity = 1
            AND problem_bin_location IS NULL
            AND exception_type IN ('defect', 'packaging_damage')));
    CREATE UNIQUE INDEX pct_held_unit_unique ON problem_center_tasks (shop_id, source_lasyncro_unit_id)
      WHERE source_lasyncro_unit_id IS NOT NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Same fail-closed rollback contract as 0208/0210: persisted held evidence
  // wins over rollback convenience. Lock first so no evidence can be written
  // between the check and schema removal; row_security=off either exposes every
  // tenant's rows to the migration role or raises, never silently hides them.
  await knex.raw(`
    LOCK TABLE ${CAPTURES}, inventory_units, problem_center_tasks, receive_job_lines,
      receive_reconciliation_finalization_lines IN ACCESS EXCLUSIVE MODE
  `);
  await knex.raw(`SET LOCAL row_security = off`);
  const result = await knex.raw(`
    SELECT (
      EXISTS (SELECT 1 FROM ${CAPTURES})
      OR EXISTS (SELECT 1 FROM inventory_units WHERE receive_held_capture_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM problem_center_tasks WHERE source_lasyncro_unit_id IS NOT NULL
                   OR receive_held_capture_id IS NOT NULL OR warehouse_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM receive_job_lines WHERE quantity_held_recoverable > 0)
      OR EXISTS (SELECT 1 FROM receive_reconciliation_finalization_lines WHERE quantity_held_recoverable > 0)
    ) AS has_evidence
  `);
  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[RECEIVE_HELD_CAPTURE_ROLLBACK_BLOCKED] persisted held-unit capture evidence exists; 0213 cannot be removed'
    );
  }

  await knex.raw(`
    DROP INDEX pct_held_unit_unique;
    ALTER TABLE problem_center_tasks
      DROP CONSTRAINT pct_held_shape,
      DROP CONSTRAINT pct_held_capture_fk,
      DROP CONSTRAINT pct_held_unit_fk,
      DROP COLUMN warehouse_id,
      DROP COLUMN receive_held_capture_id,
      DROP COLUMN source_lasyncro_unit_id;

    ALTER TABLE inventory_units
      DROP CONSTRAINT inventory_units_held_state_check,
      DROP CONSTRAINT inventory_units_held_provenance_check,
      DROP CONSTRAINT inventory_units_source_anchor_xor,
      DROP CONSTRAINT inventory_units_held_task_target,
      DROP CONSTRAINT inventory_units_held_sequence_unique,
      DROP CONSTRAINT inventory_units_held_capture_fk,
      DROP COLUMN receive_held_capture_id;
    ALTER TABLE inventory_units ADD CONSTRAINT inventory_units_source_anchor_xor CHECK (
      (receive_job_line_id IS NOT NULL AND recount_line_id IS NULL)
      OR
      (receive_job_line_id IS NULL AND recount_line_id IS NOT NULL)
    );

    DROP TABLE ${CAPTURES};

    ALTER TABLE receive_job_lines DROP CONSTRAINT receive_job_lines_held_target;
    ALTER TABLE receive_exceptions DROP CONSTRAINT receive_exceptions_held_target;
    ALTER TABLE receive_reconciliation_exception_links DROP CONSTRAINT rrel_held_target;
    ALTER TABLE receive_reconciliation_finalization_lines DROP CONSTRAINT rrfl_held_target;

    ALTER TABLE receive_reconciliation_finalization_lines DROP CONSTRAINT receive_reconciliation_finalization_lines_balanced;
    ALTER TABLE receive_reconciliation_finalization_lines DROP COLUMN quantity_held_recoverable;
    ALTER TABLE receive_reconciliation_finalization_lines ADD CONSTRAINT receive_reconciliation_finalization_lines_balanced CHECK (
      quantity_accepted + quantity_rejected + quantity_missing + quantity_deferred
        = quantity_expected + quantity_overage_approved
    );

    ALTER TABLE receive_job_lines DROP CONSTRAINT receive_delivery_disposition_valid;
    ALTER TABLE receive_job_lines ADD CONSTRAINT receive_delivery_disposition_valid CHECK (
      (quantity_delivered IS NULL OR quantity_delivered >= 0)
      AND (quantity_missing IS NULL OR quantity_missing >= 0)
      AND (quantity_deferred IS NULL OR quantity_deferred >= 0)
      AND (quantity_held_recoverable IS NULL OR quantity_held_recoverable = 0)
      AND (quantity_delivered IS NULL OR (
        inspection_complete AND quantity_missing IS NOT NULL AND quantity_deferred IS NOT NULL
        AND quantity_held_recoverable IS NOT NULL AND quantity_accepted >= 0 AND quantity_rejected >= 0
        AND quantity_delivered = quantity_accepted + quantity_rejected + quantity_held_recoverable
        AND quantity_delivered + quantity_missing + quantity_deferred >= quantity_expected
      ))
    );
  `);
  // PostgreSQL enum values are intentionally not removed (0195 precedent).
}
