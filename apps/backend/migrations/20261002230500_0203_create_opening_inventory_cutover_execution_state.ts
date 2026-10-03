import type { Knex } from 'knex';

// GH-1179 Slice E / E01 — mutable Opening Inventory cutover EXECUTION and
// verification evidence.
//
// Slice D (0201/0202) remains immutable request authority. This migration
// only references it; the single change on the Slice-D batch table is one
// additive tenant-qualified UNIQUE (generation_id, shop_id, batch_index)
// needed for the tenant-aware batch-execution FK. No Slice-D row, column,
// trigger or policy is touched.
//
// Durable provider execution evidence must never be erased by rollback
// convenience (0201/0202 precedent): down() fails closed while ANY Slice-E
// row exists.

const EXECUTIONS = 'opening_inventory_cutover_executions';
const BATCH_EXECUTIONS = 'opening_inventory_cutover_batch_executions';
const ATTEMPTS = 'opening_inventory_cutover_batch_attempts';
const VERIFICATIONS = 'opening_inventory_cutover_verifications';
const VERIFICATION_LINES = 'opening_inventory_cutover_verification_lines';

const SLICE_E_TABLES = [
  EXECUTIONS,
  BATCH_EXECUTIONS,
  ATTEMPTS,
  VERIFICATIONS,
  VERIFICATION_LINES,
];

const SLICE_D_BATCH_TENANT_UNIQUE =
  'opening_inventory_cutover_generation_batches_tenant_unique';

const RUNTIME_ROLE = 'sf_app';

export async function up(knex: Knex): Promise<void> {
  // Additive relational key on immutable Slice-D batches (no data change).
  await knex.raw(`
    ALTER TABLE opening_inventory_cutover_generation_batches
      ADD CONSTRAINT ${SLICE_D_BATCH_TENANT_UNIQUE}
        UNIQUE (generation_id, shop_id, batch_index);
  `);

  await knex.raw(`
    CREATE TABLE opening_inventory_cutover_executions (
      execution_id uuid NOT NULL DEFAULT gen_random_uuid(),
      shop_id bigint NOT NULL,
      generation_id uuid NOT NULL,

      status text NOT NULL,

      lease_token uuid NULL,
      lease_expires_at timestamptz NULL,
      lease_heartbeat_at timestamptz NULL,

      started_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),

      blocked_at timestamptz NULL,
      blocked_reason text NULL,

      terminal_at timestamptz NULL,
      terminal_reason text NULL,

      CONSTRAINT opening_inventory_cutover_executions_pk
        PRIMARY KEY (execution_id),

      CONSTRAINT opening_inventory_cutover_executions_generation_unique
        UNIQUE (generation_id),

      CONSTRAINT opening_inventory_cutover_executions_identity_unique
        UNIQUE (execution_id, shop_id, generation_id),

      CONSTRAINT opening_inventory_cutover_executions_generation_fk
        FOREIGN KEY (generation_id, shop_id)
        REFERENCES opening_inventory_cutover_generations(
          generation_id,
          shop_id
        )
        ON DELETE RESTRICT,

      CONSTRAINT opening_inventory_cutover_executions_status_valid
        CHECK (
          status IN (
            'executing',
            'verifying',
            'blocked',
            'requires_regeneration',
            'converged'
          )
        ),

      CONSTRAINT opening_inventory_cutover_executions_lease_valid
        CHECK (
          (status IN ('executing', 'verifying'))
          =
          (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        ),

      CONSTRAINT opening_inventory_cutover_executions_heartbeat_valid
        CHECK (
          lease_heartbeat_at IS NULL
          OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
        ),

      CONSTRAINT opening_inventory_cutover_executions_blocked_valid
        CHECK (
          (status = 'blocked') = (blocked_at IS NOT NULL)
        ),

      CONSTRAINT opening_inventory_cutover_executions_terminal_valid
        CHECK (
          (status IN ('requires_regeneration', 'converged'))
          =
          (terminal_at IS NOT NULL)
        )
    );

    CREATE UNIQUE INDEX opening_inventory_cutover_executions_active_shop_unique
      ON opening_inventory_cutover_executions (shop_id)
      WHERE status IN ('executing', 'verifying', 'blocked');

    CREATE INDEX opening_inventory_cutover_executions_shop_status_idx
      ON opening_inventory_cutover_executions (shop_id, status);
  `);

  await knex.raw(`
    CREATE TABLE opening_inventory_cutover_batch_executions (
      generation_id uuid NOT NULL,
      batch_index integer NOT NULL,
      shop_id bigint NOT NULL,
      execution_id uuid NOT NULL,

      status text NOT NULL DEFAULT 'pending',

      attempt_count integer NOT NULL DEFAULT 0,

      shopify_adjustment_group_id text NULL,
      succeeded_at timestamptz NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT opening_inventory_cutover_batch_executions_pk
        PRIMARY KEY (generation_id, batch_index),

      CONSTRAINT opening_inventory_cutover_batch_executions_identity_unique
        UNIQUE (execution_id, shop_id, generation_id, batch_index),

      CONSTRAINT opening_inventory_cutover_batch_executions_execution_fk
        FOREIGN KEY (execution_id, shop_id, generation_id)
        REFERENCES opening_inventory_cutover_executions(
          execution_id,
          shop_id,
          generation_id
        )
        ON DELETE RESTRICT,

      CONSTRAINT opening_inventory_cutover_batch_executions_generation_batch_fk
        FOREIGN KEY (generation_id, shop_id, batch_index)
        REFERENCES opening_inventory_cutover_generation_batches(
          generation_id,
          shop_id,
          batch_index
        )
        ON DELETE RESTRICT,

      CONSTRAINT opening_inventory_cutover_batch_executions_status_valid
        CHECK (
          status IN (
            'pending',
            'dispatching',
            'ambiguous',
            'succeeded',
            'rejected'
          )
        ),

      CONSTRAINT opening_inventory_cutover_batch_executions_attempts_valid
        CHECK (attempt_count >= 0),

      CONSTRAINT opening_inventory_cutover_batch_executions_success_valid
        CHECK (
          (status = 'succeeded') = (succeeded_at IS NOT NULL)
        )
    );

    CREATE INDEX opening_inventory_cutover_batch_executions_shop_status_idx
      ON opening_inventory_cutover_batch_executions (shop_id, status);

    CREATE INDEX opening_inventory_cutover_batch_executions_execution_idx
      ON opening_inventory_cutover_batch_executions (execution_id);
  `);

  await knex.raw(`
    CREATE TABLE opening_inventory_cutover_batch_attempts (
      attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),

      shop_id bigint NOT NULL,
      execution_id uuid NOT NULL,
      generation_id uuid NOT NULL,
      batch_index integer NOT NULL,

      attempt_number integer NOT NULL,

      dispatch_lease_token uuid NOT NULL,
      finalized_by_lease_token uuid NULL,

      request_sha256 text NOT NULL,
      requested_api_version text NOT NULL,

      started_at timestamptz NOT NULL DEFAULT now(),
      finalized_at timestamptz NULL,

      outcome text NULL,

      http_status integer NULL,
      x_request_id text NULL,
      served_api_version text NULL,

      user_errors jsonb NULL,
      shopify_adjustment_group_id text NULL,

      error_class text NULL,
      error_detail text NULL,

      CONSTRAINT opening_inventory_cutover_batch_attempts_pk
        PRIMARY KEY (attempt_id),

      CONSTRAINT opening_inventory_cutover_batch_attempts_number_unique
        UNIQUE (generation_id, batch_index, attempt_number),

      CONSTRAINT opening_inventory_cutover_batch_attempts_batch_execution_fk
        FOREIGN KEY (execution_id, shop_id, generation_id, batch_index)
        REFERENCES opening_inventory_cutover_batch_executions(
          execution_id,
          shop_id,
          generation_id,
          batch_index
        )
        ON DELETE RESTRICT,

      CONSTRAINT opening_inventory_cutover_batch_attempts_number_positive
        CHECK (attempt_number > 0),

      CONSTRAINT opening_inventory_cutover_batch_attempts_outcome_valid
        CHECK (
          outcome IS NULL
          OR outcome IN (
            'succeeded',
            'user_errors',
            'graphql_error',
            'http_error',
            'throttled',
            'no_response',
            'aborted',
            'abandoned'
          )
        ),

      CONSTRAINT opening_inventory_cutover_batch_attempts_finalization_valid
        CHECK (
          (outcome IS NULL) = (finalized_at IS NULL)
        ),

      CONSTRAINT opening_inventory_cutover_batch_attempts_finalizer_valid
        CHECK (
          (finalized_at IS NULL) = (finalized_by_lease_token IS NULL)
        )
    );

    CREATE UNIQUE INDEX opening_inventory_cutover_batch_attempts_open_unique
      ON opening_inventory_cutover_batch_attempts (generation_id, batch_index)
      WHERE finalized_at IS NULL;

    CREATE INDEX opening_inventory_cutover_batch_attempts_execution_idx
      ON opening_inventory_cutover_batch_attempts (execution_id);

    CREATE INDEX opening_inventory_cutover_batch_attempts_generation_batch_idx
      ON opening_inventory_cutover_batch_attempts (generation_id, batch_index);
  `);

  await knex.raw(`
    CREATE TABLE opening_inventory_cutover_verifications (
      verification_id uuid NOT NULL DEFAULT gen_random_uuid(),

      shop_id bigint NOT NULL,
      execution_id uuid NOT NULL,
      generation_id uuid NOT NULL,

      purpose text NOT NULL,
      batch_index integer NULL,

      started_by_lease_token uuid NOT NULL,
      finalized_by_lease_token uuid NULL,

      status text NOT NULL DEFAULT 'collecting',

      requested_api_version text NOT NULL,
      served_api_version text NULL,

      page_count integer NOT NULL DEFAULT 0,

      read_started_at timestamptz NOT NULL DEFAULT now(),
      read_completed_at timestamptz NULL,

      readiness_passed boolean NULL,
      target_fingerprint text NULL,
      identity_fingerprint text NULL,

      shop_gid text NOT NULL,
      location_gid text NOT NULL,

      verdict text NULL,

      CONSTRAINT opening_inventory_cutover_verifications_pk
        PRIMARY KEY (verification_id),

      CONSTRAINT opening_inventory_cutover_verifications_tenant_unique
        UNIQUE (verification_id, shop_id),

      CONSTRAINT opening_inventory_cutover_verifications_execution_fk
        FOREIGN KEY (execution_id, shop_id, generation_id)
        REFERENCES opening_inventory_cutover_executions(
          execution_id,
          shop_id,
          generation_id
        )
        ON DELETE RESTRICT,

      CONSTRAINT opening_inventory_cutover_verifications_purpose_valid
        CHECK (
          purpose IN ('ambiguity_inspection', 'final_convergence')
        ),

      CONSTRAINT opening_inventory_cutover_verifications_status_valid
        CHECK (
          status IN ('collecting', 'complete', 'failed', 'abandoned')
        ),

      CONSTRAINT opening_inventory_cutover_verifications_verdict_valid
        CHECK (
          verdict IS NULL
          OR verdict IN (
            'applied',
            'not_applied',
            'mixed',
            'converged',
            'not_converged'
          )
        ),

      CONSTRAINT opening_inventory_cutover_verifications_page_count_valid
        CHECK (page_count >= 0),

      CONSTRAINT opening_inventory_cutover_verifications_purpose_batch_valid
        CHECK (
          (purpose = 'ambiguity_inspection' AND batch_index IS NOT NULL)
          OR
          (purpose = 'final_convergence' AND batch_index IS NULL)
        ),

      CONSTRAINT opening_inventory_cutover_verifications_lifecycle_valid
        CHECK (
          (
            status = 'collecting'
            AND read_completed_at IS NULL
            AND finalized_by_lease_token IS NULL
            AND verdict IS NULL
          )
          OR
          (
            status = 'complete'
            AND read_completed_at IS NOT NULL
            AND finalized_by_lease_token IS NOT NULL
            AND verdict IS NOT NULL
          )
          OR
          (
            status IN ('failed', 'abandoned')
            AND read_completed_at IS NOT NULL
            AND finalized_by_lease_token IS NOT NULL
          )
        )
    );

    CREATE INDEX opening_inventory_cutover_verifications_execution_idx
      ON opening_inventory_cutover_verifications (execution_id);

    CREATE INDEX opening_inventory_cutover_verifications_generation_purpose_idx
      ON opening_inventory_cutover_verifications (generation_id, purpose);
  `);

  await knex.raw(`
    CREATE TABLE opening_inventory_cutover_verification_lines (
      verification_id uuid NOT NULL,
      shop_id bigint NOT NULL,

      shopify_inventory_item_gid text NOT NULL,

      observed_on_hand integer NULL,
      level_present boolean NOT NULL,
      active boolean NULL,
      tracked boolean NULL,

      expected_target integer NULL,
      frozen_change_from integer NULL,

      line_verdict text NOT NULL,

      CONSTRAINT opening_inventory_cutover_verification_lines_pk
        PRIMARY KEY (verification_id, shopify_inventory_item_gid),

      CONSTRAINT opening_inventory_cutover_verification_lines_verification_fk
        FOREIGN KEY (verification_id, shop_id)
        REFERENCES opening_inventory_cutover_verifications(
          verification_id,
          shop_id
        )
        ON DELETE RESTRICT,

      CONSTRAINT opening_inventory_cutover_verification_lines_verdict_valid
        CHECK (
          line_verdict IN (
            'match',
            'mismatch',
            'old_state',
            'unknown_item',
            'inactive',
            'untracked'
          )
        )
    );

    CREATE INDEX opening_inventory_cutover_verification_lines_shop_idx
      ON opening_inventory_cutover_verification_lines (shop_id, verification_id);
  `);

  // ---------------------------------------------------------------------
  // Executions: identity immutable, ratified transitions only, terminal
  // rows fully immutable.
  // ---------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      guard_opening_inventory_cutover_execution_update()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.execution_id IS DISTINCT FROM OLD.execution_id
         OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
         OR NEW.generation_id IS DISTINCT FROM OLD.generation_id THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_IDENTITY_IMMUTABLE] execution identity cannot be changed';
      END IF;

      IF OLD.status IN ('converged', 'requires_regeneration') THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_TERMINAL_IMMUTABLE] terminal execution cannot be changed';
      END IF;

      IF NEW.status IS DISTINCT FROM OLD.status
         AND NOT (
           (
             OLD.status = 'executing'
             AND NEW.status IN ('verifying', 'blocked', 'requires_regeneration')
           )
           OR
           (
             OLD.status = 'verifying'
             AND NEW.status IN ('blocked', 'requires_regeneration', 'converged')
           )
         ) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_TRANSITION_INVALID] % -> % is not an allowed execution transition',
          OLD.status, NEW.status;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_executions_update_guard
    BEFORE UPDATE ON opening_inventory_cutover_executions
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_execution_update();
  `);

  // ---------------------------------------------------------------------
  // Batch executions: identity immutable; succeeded is final.
  // ---------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      guard_opening_inventory_cutover_batch_execution_update()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.generation_id IS DISTINCT FROM OLD.generation_id
         OR NEW.batch_index IS DISTINCT FROM OLD.batch_index
         OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
         OR NEW.execution_id IS DISTINCT FROM OLD.execution_id THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_BATCH_IDENTITY_IMMUTABLE] batch execution identity cannot be changed';
      END IF;

      IF OLD.status = 'succeeded' THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_BATCH_SUCCEEDED_IMMUTABLE] succeeded batch execution cannot be changed';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_batch_executions_update_guard
    BEFORE UPDATE ON opening_inventory_cutover_batch_executions
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_batch_execution_update();
  `);

  // ---------------------------------------------------------------------
  // Attempts: unfinalized insert bound to the immutable Slice-D request
  // identity; one-shot finalization; immutable afterwards.
  // ---------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      guard_opening_inventory_cutover_batch_attempt_insert()
    RETURNS trigger AS $$
    DECLARE
      authoritative_sha256 text;
    BEGIN
      IF NEW.finalized_at IS NOT NULL
         OR NEW.outcome IS NOT NULL
         OR NEW.finalized_by_lease_token IS NOT NULL THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_ATTEMPT_STATE] a dispatch attempt must begin unfinalized';
      END IF;

      SELECT b.request_sha256
        INTO authoritative_sha256
        FROM opening_inventory_cutover_generation_batches b
       WHERE b.generation_id = NEW.generation_id
         AND b.shop_id = NEW.shop_id
         AND b.batch_index = NEW.batch_index;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_ATTEMPT_REQUEST_AUTHORITY] immutable generation batch request does not exist for this tenant';
      END IF;

      IF NEW.request_sha256 IS DISTINCT FROM authoritative_sha256 THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_ATTEMPT_REQUEST_AUTHORITY] attempt request_sha256 differs from the immutable generation batch request';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_batch_attempts_insert_guard
    BEFORE INSERT ON opening_inventory_cutover_batch_attempts
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_batch_attempt_insert();

    CREATE OR REPLACE FUNCTION
      guard_opening_inventory_cutover_batch_attempt_update()
    RETURNS trigger AS $$
    DECLARE
      result_fields text[] := ARRAY[
        'finalized_at',
        'outcome',
        'finalized_by_lease_token',
        'http_status',
        'x_request_id',
        'served_api_version',
        'user_errors',
        'shopify_adjustment_group_id',
        'error_class',
        'error_detail'
      ];
    BEGIN
      IF OLD.finalized_at IS NOT NULL THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_ATTEMPT_FINALIZED_IMMUTABLE] finalized attempt cannot be changed';
      END IF;

      -- Request and identity facts are immutable on every UPDATE.
      IF (to_jsonb(NEW) - result_fields)
           IS DISTINCT FROM (to_jsonb(OLD) - result_fields) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_ATTEMPT_IDENTITY_IMMUTABLE] attempt request/identity cannot be changed';
      END IF;

      -- An open attempt may only be finalized (exactly once). The finalizer
      -- lease may differ from the dispatch lease (lease takeover abandon).
      IF NEW.finalized_at IS NULL
         OR NEW.outcome IS NULL
         OR NEW.finalized_by_lease_token IS NULL THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_ATTEMPT_FINALIZATION] an open attempt may only be updated by finalizing it';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_batch_attempts_update_guard
    BEFORE UPDATE ON opening_inventory_cutover_batch_attempts
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_batch_attempt_update();
  `);

  // ---------------------------------------------------------------------
  // Verifications: identity immutable; collecting -> complete/failed/
  // abandoned only; terminal rows fully immutable.
  // ---------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      guard_opening_inventory_cutover_verification_update()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.verification_id IS DISTINCT FROM OLD.verification_id
         OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
         OR NEW.execution_id IS DISTINCT FROM OLD.execution_id
         OR NEW.generation_id IS DISTINCT FROM OLD.generation_id
         OR NEW.purpose IS DISTINCT FROM OLD.purpose
         OR NEW.batch_index IS DISTINCT FROM OLD.batch_index
         OR NEW.started_by_lease_token IS DISTINCT FROM OLD.started_by_lease_token
         OR NEW.requested_api_version IS DISTINCT FROM OLD.requested_api_version
         OR NEW.shop_gid IS DISTINCT FROM OLD.shop_gid
         OR NEW.location_gid IS DISTINCT FROM OLD.location_gid THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_VERIFICATION_IDENTITY_IMMUTABLE] verification identity cannot be changed';
      END IF;

      IF OLD.status IS DISTINCT FROM 'collecting' THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_VERIFICATION_TERMINAL_IMMUTABLE] terminal verification cannot be changed';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_verifications_update_guard
    BEFORE UPDATE ON opening_inventory_cutover_verifications
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_verification_update();
  `);

  // ---------------------------------------------------------------------
  // Verification lines: append-only while the parent is collecting.
  // ---------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      guard_opening_inventory_cutover_verification_line_insert()
    RETURNS trigger AS $$
    DECLARE
      parent_status text;
    BEGIN
      -- FOR SHARE serializes against the parent's terminal transition.
      SELECT status
        INTO parent_status
        FROM opening_inventory_cutover_verifications
       WHERE verification_id = NEW.verification_id
         AND shop_id = NEW.shop_id
         FOR SHARE;

      IF parent_status IS DISTINCT FROM 'collecting' THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_EXECUTION_VERIFICATION_LINE_STATE] lines may only be added to a collecting verification';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_verification_lines_insert_guard
    BEFORE INSERT ON opening_inventory_cutover_verification_lines
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_verification_line_insert();

    CREATE OR REPLACE FUNCTION
      prevent_opening_inventory_cutover_verification_line_update()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[OPENING_INVENTORY_CUTOVER_EXECUTION_VERIFICATION_LINE_IMMUTABLE] verification lines cannot be changed';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_verification_lines_immutable
    BEFORE UPDATE ON opening_inventory_cutover_verification_lines
    FOR EACH ROW
    EXECUTE FUNCTION prevent_opening_inventory_cutover_verification_line_update();
  `);

  // ---------------------------------------------------------------------
  // Durable evidence: DELETE is always rejected on every Slice-E table.
  // ---------------------------------------------------------------------
  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      prevent_opening_inventory_cutover_execution_evidence_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[OPENING_INVENTORY_CUTOVER_EXECUTION_DELETE_BLOCKED] durable cutover execution evidence cannot be deleted';
    END;
    $$ LANGUAGE plpgsql;
  `);

  for (const table of SLICE_E_TABLES) {
    await knex.raw(
      `
        CREATE TRIGGER ??
        BEFORE DELETE ON ??
        FOR EACH ROW
        EXECUTE FUNCTION
          prevent_opening_inventory_cutover_execution_evidence_delete()
      `,
      [`${table}_no_delete`, table]
    );
  }

  // ---------------------------------------------------------------------
  // RLS: every Slice-E table is directly tenant-owned (0201 policy form).
  // ---------------------------------------------------------------------
  for (const table of SLICE_E_TABLES) {
    await knex.raw(`ALTER TABLE ?? ENABLE ROW LEVEL SECURITY`, [table]);
    await knex.raw(`ALTER TABLE ?? FORCE ROW LEVEL SECURITY`, [table]);

    await knex.raw(
      `
        CREATE POLICY ??
        ON ??
        FOR ALL
        USING (
          shop_id =
            NULLIF(
              current_setting('app.current_tenant', true),
              ''
            )::integer
          AND
            NULLIF(
              current_setting('app.current_tenant', true),
              ''
            )::integer > 0
        )
        WITH CHECK (
          shop_id =
            NULLIF(
              current_setting('app.current_tenant', true),
              ''
            )::integer
          AND
            NULLIF(
              current_setting('app.current_tenant', true),
              ''
            )::integer > 0
        )
      `,
      [`${table}_tenant_policy`, table]
    );

    // Runtime role (0105 default privileges would also grant DELETE; durable
    // execution evidence is never deletable by the application).
    await knex.raw(`GRANT SELECT, INSERT, UPDATE ON ?? TO ??`, [
      table,
      RUNTIME_ROLE,
    ]);
    await knex.raw(`REVOKE DELETE ON ?? FROM ??`, [table, RUNTIME_ROLE]);
  }
}

export async function down(knex: Knex): Promise<void> {
  // Durable provider execution evidence wins over rollback convenience
  // (0201/0202 precedent). Lock first so no evidence can be written between
  // the evidence check and schema removal.
  await knex.raw(`
    LOCK TABLE
      opening_inventory_cutover_executions,
      opening_inventory_cutover_batch_executions,
      opening_inventory_cutover_batch_attempts,
      opening_inventory_cutover_verifications,
      opening_inventory_cutover_verification_lines
    IN ACCESS EXCLUSIVE MODE
  `);

  // row_security=off either exposes all rows for the migration role or raises
  // rather than silently hiding evidence behind FORCE RLS.
  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT (
      EXISTS (SELECT 1 FROM opening_inventory_cutover_executions LIMIT 1)
      OR EXISTS (SELECT 1 FROM opening_inventory_cutover_batch_executions LIMIT 1)
      OR EXISTS (SELECT 1 FROM opening_inventory_cutover_batch_attempts LIMIT 1)
      OR EXISTS (SELECT 1 FROM opening_inventory_cutover_verifications LIMIT 1)
      OR EXISTS (SELECT 1 FROM opening_inventory_cutover_verification_lines LIMIT 1)
    ) AS has_evidence
  `);

  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[OPENING_INVENTORY_CUTOVER_EXECUTION_ROLLBACK_BLOCKED] durable cutover execution evidence exists; Slice-E execution state cannot be removed'
    );
  }

  // Dependency-safe order; triggers and policies go with their tables.
  await knex.raw(`
    DROP TABLE IF EXISTS opening_inventory_cutover_verification_lines;
    DROP TABLE IF EXISTS opening_inventory_cutover_batch_attempts;
    DROP TABLE IF EXISTS opening_inventory_cutover_verifications;
    DROP TABLE IF EXISTS opening_inventory_cutover_batch_executions;
    DROP TABLE IF EXISTS opening_inventory_cutover_executions;
  `);

  await knex.raw(`
    DROP FUNCTION IF EXISTS
      prevent_opening_inventory_cutover_execution_evidence_delete();

    DROP FUNCTION IF EXISTS
      prevent_opening_inventory_cutover_verification_line_update();

    DROP FUNCTION IF EXISTS
      guard_opening_inventory_cutover_verification_line_insert();

    DROP FUNCTION IF EXISTS
      guard_opening_inventory_cutover_verification_update();

    DROP FUNCTION IF EXISTS
      guard_opening_inventory_cutover_batch_attempt_update();

    DROP FUNCTION IF EXISTS
      guard_opening_inventory_cutover_batch_attempt_insert();

    DROP FUNCTION IF EXISTS
      guard_opening_inventory_cutover_batch_execution_update();

    DROP FUNCTION IF EXISTS
      guard_opening_inventory_cutover_execution_update();
  `);

  // Remove ONLY the additive 0203-owned key from the Slice-D batch table.
  await knex.raw(`
    ALTER TABLE opening_inventory_cutover_generation_batches
      DROP CONSTRAINT IF EXISTS ${SLICE_D_BATCH_TENANT_UNIQUE};
  `);
}
