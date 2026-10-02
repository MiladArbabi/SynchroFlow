import type { Knex } from 'knex';

const GENERATIONS = 'opening_inventory_cutover_generations';
const ENTRIES = 'opening_inventory_cutover_generation_entries';
const BATCHES = 'opening_inventory_cutover_generation_batches';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE opening_inventory_cutover_generations (
      generation_id uuid PRIMARY KEY,
      shop_id bigint NOT NULL,
      generation_sequence integer NOT NULL,

      opening_snapshot_id uuid NOT NULL
        REFERENCES opening_inventory_shopify_snapshots(snapshot_id)
        ON DELETE RESTRICT,

      warehouse_id uuid NOT NULL
        REFERENCES warehouses(warehouse_id)
        ON DELETE RESTRICT,

      shopify_location_gid text NOT NULL,
      shopify_shop_domain text NOT NULL,

      requested_api_version text NOT NULL,
      served_api_version text NOT NULL,
      cas_mode text NOT NULL,

      quantity_name text NOT NULL,
      reason text NOT NULL,

      approved_by_actor_type text NOT NULL,
      approved_by_actor_id text NOT NULL,
      approved_by_role text NOT NULL,
      approved_at timestamptz NOT NULL,
      physical_truth_accepted_at timestamptz NULL,

      identity_fingerprint text NOT NULL,
      target_fingerprint text NOT NULL,
      provider_read_fingerprint text NOT NULL,
      generation_fingerprint text NOT NULL,

      canonicalization_version text NOT NULL,
      batching_version text NOT NULL,
      batch_size integer NOT NULL,

      provider_read_started_at timestamptz NOT NULL,
      provider_read_completed_at timestamptz NOT NULL,
      provider_page_count integer NOT NULL,

      target_item_count integer NOT NULL,
      provider_only_item_count integer NOT NULL,
      write_count integer NOT NULL,
      batch_count integer NOT NULL,

      status text NOT NULL DEFAULT 'assembling',
      frozen_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT opening_inventory_cutover_generations_shop_sequence_unique
        UNIQUE (shop_id, generation_sequence),

      CONSTRAINT opening_inventory_cutover_generations_tenant_identity_unique
        UNIQUE (generation_id, shop_id),

      CONSTRAINT opening_inventory_cutover_generations_sequence_positive
        CHECK (generation_sequence > 0),

      CONSTRAINT opening_inventory_cutover_generations_location_gid_valid
        CHECK (
          shopify_location_gid ~ '^gid://shopify/Location/[0-9]+$'
        ),

      CONSTRAINT opening_inventory_cutover_generations_shop_domain_present
        CHECK (length(btrim(shopify_shop_domain)) > 0),

      CONSTRAINT opening_inventory_cutover_generations_requested_version_valid
        CHECK (
          requested_api_version ~ '^[0-9]{4}-[0-9]{2}$'
        ),

      CONSTRAINT opening_inventory_cutover_generations_served_contract_valid
        CHECK (
          served_api_version = '2026-04'
          AND cas_mode = 'change_from_quantity'
        ),

      CONSTRAINT opening_inventory_cutover_generations_quantity_name_valid
        CHECK (quantity_name = 'on_hand'),

      CONSTRAINT opening_inventory_cutover_generations_reason_valid
        CHECK (reason = 'correction'),

      CONSTRAINT opening_inventory_cutover_generations_actor_valid
        CHECK (
          approved_by_actor_type = 'user'
          AND length(btrim(approved_by_actor_id)) > 0
        ),

      CONSTRAINT opening_inventory_cutover_generations_role_valid
        CHECK (approved_by_role IN ('owner', 'admin')),

      CONSTRAINT opening_inventory_cutover_generations_identity_hash_valid
        CHECK (identity_fingerprint ~ '^[0-9a-f]{64}$'),

      CONSTRAINT opening_inventory_cutover_generations_target_hash_valid
        CHECK (target_fingerprint ~ '^[0-9a-f]{64}$'),

      CONSTRAINT opening_inventory_cutover_generations_provider_hash_valid
        CHECK (provider_read_fingerprint ~ '^[0-9a-f]{64}$'),

      CONSTRAINT opening_inventory_cutover_generations_generation_hash_valid
        CHECK (generation_fingerprint ~ '^[0-9a-f]{64}$'),

      CONSTRAINT opening_inventory_cutover_generations_batch_size_valid
        CHECK (batch_size BETWEEN 1 AND 250),

      CONSTRAINT opening_inventory_cutover_generations_provider_interval_valid
        CHECK (
          provider_read_completed_at >= provider_read_started_at
        ),

      CONSTRAINT opening_inventory_cutover_generations_page_count_valid
        CHECK (provider_page_count > 0),

      CONSTRAINT opening_inventory_cutover_generations_counts_valid
        CHECK (
          target_item_count >= 0
          AND provider_only_item_count >= 0
          AND write_count >= 0
          AND batch_count >= 0
          AND write_count <= target_item_count
          AND (
            (write_count = 0 AND batch_count = 0)
            OR
            (write_count > 0 AND batch_count > 0)
          )
        ),

      CONSTRAINT opening_inventory_cutover_generations_status_valid
        CHECK (
          (status = 'assembling' AND frozen_at IS NULL)
          OR
          (status = 'frozen' AND frozen_at IS NOT NULL)
        )
    );
  `);

  await knex.raw(`
    CREATE TABLE opening_inventory_cutover_generation_entries (
      generation_id uuid NOT NULL,
      shop_id bigint NOT NULL,
      ordinal integer NOT NULL,

      lasyncro_variant_id uuid NULL,
      shopify_inventory_item_gid text NOT NULL,
      shopify_variant_gid text NULL,

      target_quantity integer NULL,
      observed_on_hand_quantity integer NULL,

      inventory_level_present boolean NOT NULL,
      inventory_level_active boolean NULL,
      tracked boolean NULL,

      disposition text NOT NULL,
      batch_index integer NULL,
      batch_position integer NULL,

      created_at timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT opening_inventory_cutover_generation_entries_pk
        PRIMARY KEY (generation_id, ordinal),

      CONSTRAINT opening_inventory_cutover_generation_entries_parent_fk
        FOREIGN KEY (generation_id, shop_id)
        REFERENCES opening_inventory_cutover_generations(
          generation_id,
          shop_id
        )
        ON DELETE RESTRICT,

      CONSTRAINT opening_inventory_cutover_generation_entries_ordinal_valid
        CHECK (ordinal > 0),

      CONSTRAINT opening_inventory_cutover_generation_entries_item_gid_valid
        CHECK (
          shopify_inventory_item_gid ~
            '^gid://shopify/InventoryItem/[0-9]+$'
        ),

      CONSTRAINT opening_inventory_cutover_generation_entries_variant_gid_valid
        CHECK (
          shopify_variant_gid IS NULL
          OR shopify_variant_gid ~
            '^gid://shopify/ProductVariant/[0-9]+$'
        ),

      CONSTRAINT opening_inventory_cutover_generation_entries_target_valid
        CHECK (
          target_quantity IS NULL
          OR target_quantity >= 0
        ),

      CONSTRAINT opening_inventory_cutover_generation_entries_disposition_valid
        CHECK (
          disposition IN ('write', 'no_op', 'provider_only_zero')
        ),

      CONSTRAINT opening_inventory_cutover_generation_entries_shape_valid
        CHECK (
          (
            disposition = 'write'
            AND lasyncro_variant_id IS NOT NULL
            AND target_quantity IS NOT NULL
            AND observed_on_hand_quantity IS NOT NULL
            AND target_quantity <> observed_on_hand_quantity
            AND inventory_level_present = true
            AND inventory_level_active = true
            AND tracked = true
            AND batch_index IS NOT NULL
            AND batch_index > 0
            AND batch_position IS NOT NULL
            AND batch_position BETWEEN 1 AND 250
          )
          OR
          (
            disposition = 'no_op'
            AND lasyncro_variant_id IS NOT NULL
            AND target_quantity IS NOT NULL
            AND observed_on_hand_quantity IS NOT NULL
            AND target_quantity = observed_on_hand_quantity
            AND inventory_level_present = true
            AND inventory_level_active = true
            AND tracked = true
            AND batch_index IS NULL
            AND batch_position IS NULL
          )
          OR
          (
            disposition = 'provider_only_zero'
            AND target_quantity IS NULL
            AND observed_on_hand_quantity = 0
            AND inventory_level_present = true
            AND batch_index IS NULL
            AND batch_position IS NULL
          )
        )
    );

    CREATE UNIQUE INDEX opening_inventory_cutover_generation_entries_item_unique
      ON opening_inventory_cutover_generation_entries (
        generation_id,
        shopify_inventory_item_gid
      );

    CREATE UNIQUE INDEX opening_inventory_cutover_generation_entries_variant_unique
      ON opening_inventory_cutover_generation_entries (
        generation_id,
        lasyncro_variant_id
      )
      WHERE lasyncro_variant_id IS NOT NULL
        AND disposition IN ('write', 'no_op');
  `);

  await knex.raw(`
    CREATE TABLE opening_inventory_cutover_generation_batches (
      generation_id uuid NOT NULL,
      shop_id bigint NOT NULL,
      batch_index integer NOT NULL,

      requested_api_version text NOT NULL,
      served_api_version text NOT NULL,
      cas_mode text NOT NULL,

      operation_name text NOT NULL,
      graphql_document text NOT NULL,
      canonical_variables text NOT NULL,

      reference_document_uri text NOT NULL,
      idempotency_key text NULL,

      request_sha256 text NOT NULL,
      entry_count integer NOT NULL,

      created_at timestamptz NOT NULL DEFAULT now(),

      CONSTRAINT opening_inventory_cutover_generation_batches_pk
        PRIMARY KEY (generation_id, batch_index),

      CONSTRAINT opening_inventory_cutover_generation_batches_parent_fk
        FOREIGN KEY (generation_id, shop_id)
        REFERENCES opening_inventory_cutover_generations(
          generation_id,
          shop_id
        )
        ON DELETE RESTRICT,

      CONSTRAINT opening_inventory_cutover_generation_batches_index_valid
        CHECK (batch_index > 0),

      CONSTRAINT opening_inventory_cutover_generation_batches_requested_version_valid
        CHECK (
          requested_api_version ~ '^[0-9]{4}-[0-9]{2}$'
        ),

      CONSTRAINT opening_inventory_cutover_generation_batches_contract_valid
        CHECK (
          served_api_version = '2026-04'
          AND cas_mode = 'change_from_quantity'
          AND idempotency_key IS NOT NULL
        ),

      CONSTRAINT opening_inventory_cutover_generation_batches_operation_valid
        CHECK (length(btrim(operation_name)) > 0),

      CONSTRAINT opening_inventory_cutover_generation_batches_document_valid
        CHECK (length(graphql_document) > 0),

      CONSTRAINT opening_inventory_cutover_generation_batches_variables_valid
        CHECK (length(canonical_variables) > 0),

      CONSTRAINT opening_inventory_cutover_generation_batches_reference_valid
        CHECK (
          reference_document_uri LIKE
            'gid://lasyncro/OpeningInventoryCutover/%'
        ),

      CONSTRAINT opening_inventory_cutover_generation_batches_hash_valid
        CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),

      CONSTRAINT opening_inventory_cutover_generation_batches_count_valid
        CHECK (entry_count BETWEEN 1 AND 250)
    );

    CREATE UNIQUE INDEX opening_inventory_cutover_generation_batches_idempotency_unique
      ON opening_inventory_cutover_generation_batches (idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      guard_opening_inventory_cutover_generation_insert()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.status IS DISTINCT FROM 'assembling'
         OR NEW.frozen_at IS NOT NULL THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_STATE] new generation must begin assembling';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM opening_inventory_shopify_snapshots s
        WHERE s.snapshot_id = NEW.opening_snapshot_id
          AND s.shop_id = NEW.shop_id
          AND s.warehouse_id = NEW.warehouse_id
          AND s.shopify_location_id = NEW.shopify_location_gid
          AND s.status = 'complete'
      ) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_SCOPE] complete scoped snapshot does not match generation';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM warehouses w
        WHERE w.warehouse_id = NEW.warehouse_id
          AND w.shop_id = NEW.shop_id
      ) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_WAREHOUSE] warehouse does not belong to tenant';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_generations_insert_guard
    BEFORE INSERT ON opening_inventory_cutover_generations
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_generation_insert();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      guard_opening_inventory_cutover_generation_child_insert()
    RETURNS trigger AS $$
    DECLARE
      parent_status text;
      parent_requested_version text;
      parent_served_version text;
      parent_cas_mode text;
    BEGIN
      SELECT
        status,
        requested_api_version,
        served_api_version,
        cas_mode
      INTO
        parent_status,
        parent_requested_version,
        parent_served_version,
        parent_cas_mode
      FROM opening_inventory_cutover_generations
      WHERE generation_id = NEW.generation_id
        AND shop_id = NEW.shop_id
      FOR SHARE;

      IF parent_status IS DISTINCT FROM 'assembling' THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_CHILD_STATE] children may only be added while assembling';
      END IF;

      IF TG_TABLE_NAME =
           'opening_inventory_cutover_generation_batches' THEN
        IF NEW.requested_api_version IS DISTINCT FROM
             parent_requested_version
           OR NEW.served_api_version IS DISTINCT FROM
             parent_served_version
           OR NEW.cas_mode IS DISTINCT FROM
             parent_cas_mode THEN
          RAISE EXCEPTION
            '[OPENING_INVENTORY_CUTOVER_GENERATION_BATCH_CONTRACT] batch provider contract differs from generation';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_generation_entries_insert_guard
    BEFORE INSERT ON opening_inventory_cutover_generation_entries
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_generation_child_insert();

    CREATE TRIGGER opening_inventory_cutover_generation_batches_insert_guard
    BEFORE INSERT ON opening_inventory_cutover_generation_batches
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_generation_child_insert();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      prevent_opening_inventory_cutover_generation_child_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[OPENING_INVENTORY_CUTOVER_GENERATION_CHILD_IMMUTABLE] generation request facts cannot be changed';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_generation_entries_immutable
    BEFORE UPDATE OR DELETE
    ON opening_inventory_cutover_generation_entries
    FOR EACH ROW
    EXECUTE FUNCTION
      prevent_opening_inventory_cutover_generation_child_mutation();

    CREATE TRIGGER opening_inventory_cutover_generation_batches_immutable
    BEFORE UPDATE OR DELETE
    ON opening_inventory_cutover_generation_batches
    FOR EACH ROW
    EXECUTE FUNCTION
      prevent_opening_inventory_cutover_generation_child_mutation();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      guard_opening_inventory_cutover_generation_freeze()
    RETURNS trigger AS $$
    DECLARE
      total_entries integer;
      target_entries integer;
      provider_only_entries integer;
      write_entries integer;
      min_entry_ordinal integer;
      max_entry_ordinal integer;

      persisted_batches integer;
      persisted_batch_entries integer;
      min_batch_index integer;
      max_batch_index integer;
    BEGIN
      IF OLD.status IS DISTINCT FROM 'assembling' THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_IMMUTABLE] frozen generation cannot be changed';
      END IF;

      IF NEW.status IS DISTINCT FROM 'frozen'
         OR NEW.frozen_at IS NULL THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_FREEZE] only assembling to frozen is allowed';
      END IF;

      IF (
        to_jsonb(NEW) - ARRAY['status', 'frozen_at']::text[]
      ) IS DISTINCT FROM (
        to_jsonb(OLD) - ARRAY['status', 'frozen_at']::text[]
      ) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_IMMUTABLE] freeze cannot rewrite request facts';
      END IF;

      SELECT
        COUNT(*)::integer,
        COUNT(*) FILTER (
          WHERE disposition IN ('write', 'no_op')
        )::integer,
        COUNT(*) FILTER (
          WHERE disposition = 'provider_only_zero'
        )::integer,
        COUNT(*) FILTER (
          WHERE disposition = 'write'
        )::integer,
        MIN(ordinal),
        MAX(ordinal)
      INTO
        total_entries,
        target_entries,
        provider_only_entries,
        write_entries,
        min_entry_ordinal,
        max_entry_ordinal
      FROM opening_inventory_cutover_generation_entries
      WHERE generation_id = OLD.generation_id
        AND shop_id = OLD.shop_id;

      IF target_entries IS DISTINCT FROM NEW.target_item_count
         OR provider_only_entries IS DISTINCT FROM
              NEW.provider_only_item_count
         OR write_entries IS DISTINCT FROM NEW.write_count THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_COUNTS] entry counts do not match frozen header';
      END IF;

      IF total_entries > 0
         AND (
           min_entry_ordinal IS DISTINCT FROM 1
           OR max_entry_ordinal IS DISTINCT FROM total_entries
         ) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_ORDINALS] entry ordinals must be contiguous';
      END IF;

      SELECT
        COUNT(*)::integer,
        COALESCE(SUM(entry_count), 0)::integer,
        MIN(batch_index),
        MAX(batch_index)
      INTO
        persisted_batches,
        persisted_batch_entries,
        min_batch_index,
        max_batch_index
      FROM opening_inventory_cutover_generation_batches
      WHERE generation_id = OLD.generation_id
        AND shop_id = OLD.shop_id;

      IF persisted_batches IS DISTINCT FROM NEW.batch_count
         OR persisted_batch_entries IS DISTINCT FROM NEW.write_count THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_BATCH_COUNTS] batch counts do not match frozen header';
      END IF;

      IF persisted_batches > 0
         AND (
           min_batch_index IS DISTINCT FROM 1
           OR max_batch_index IS DISTINCT FROM persisted_batches
         ) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_BATCH_ORDINALS] batch indexes must be contiguous';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM opening_inventory_cutover_generation_batches b
        LEFT JOIN opening_inventory_cutover_generation_entries e
          ON e.generation_id = b.generation_id
         AND e.shop_id = b.shop_id
         AND e.disposition = 'write'
         AND e.batch_index = b.batch_index
        WHERE b.generation_id = OLD.generation_id
          AND b.shop_id = OLD.shop_id
        GROUP BY
          b.generation_id,
          b.batch_index,
          b.entry_count
        HAVING
          COUNT(e.ordinal)::integer <> b.entry_count
          OR MIN(e.batch_position) IS DISTINCT FROM 1
          OR MAX(e.batch_position) IS DISTINCT FROM b.entry_count
      ) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_BATCH_MEMBERSHIP] batch membership is incomplete';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM opening_inventory_cutover_generation_entries e
        LEFT JOIN opening_inventory_cutover_generation_batches b
          ON b.generation_id = e.generation_id
         AND b.shop_id = e.shop_id
         AND b.batch_index = e.batch_index
        WHERE e.generation_id = OLD.generation_id
          AND e.shop_id = OLD.shop_id
          AND e.disposition = 'write'
          AND b.generation_id IS NULL
      ) THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_BATCH_MEMBERSHIP] write entry references missing batch';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_generations_freeze_guard
    BEFORE UPDATE ON opening_inventory_cutover_generations
    FOR EACH ROW
    EXECUTE FUNCTION guard_opening_inventory_cutover_generation_freeze();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      assert_opening_inventory_cutover_generation_frozen_at_commit()
    RETURNS trigger AS $$
    DECLARE
      current_status text;
      current_frozen_at timestamptz;
    BEGIN
      SELECT
        status,
        frozen_at
      INTO
        current_status,
        current_frozen_at
      FROM opening_inventory_cutover_generations
      WHERE generation_id = NEW.generation_id
        AND shop_id = NEW.shop_id;

      IF NOT FOUND THEN
        RETURN NEW;
      END IF;

      IF current_status IS DISTINCT FROM 'frozen'
         OR current_frozen_at IS NULL THEN
        RAISE EXCEPTION
          '[OPENING_INVENTORY_CUTOVER_GENERATION_UNFINISHED] generation must be frozen before transaction commit';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE CONSTRAINT TRIGGER
      opening_inventory_cutover_generations_frozen_at_commit
    AFTER INSERT OR UPDATE
    ON opening_inventory_cutover_generations
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION
      assert_opening_inventory_cutover_generation_frozen_at_commit();
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION
      prevent_opening_inventory_cutover_generation_delete()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[OPENING_INVENTORY_CUTOVER_GENERATION_DELETE_BLOCKED] durable cutover generation evidence cannot be deleted';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_cutover_generations_no_delete
    BEFORE DELETE ON opening_inventory_cutover_generations
    FOR EACH ROW
    EXECUTE FUNCTION prevent_opening_inventory_cutover_generation_delete();
  `);

  for (const table of [GENERATIONS, ENTRIES, BATCHES]) {
    await knex.raw(
      `ALTER TABLE ?? ENABLE ROW LEVEL SECURITY`,
      [table]
    );

    await knex.raw(
      `ALTER TABLE ?? FORCE ROW LEVEL SECURITY`,
      [table]
    );
  }

  await knex.raw(`
    CREATE POLICY opening_inventory_cutover_generations_tenant_isolation_policy
    ON opening_inventory_cutover_generations
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
    );

    CREATE POLICY opening_inventory_cutover_generation_entries_tenant_isolation_policy
    ON opening_inventory_cutover_generation_entries
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
    );

    CREATE POLICY opening_inventory_cutover_generation_batches_tenant_isolation_policy
    ON opening_inventory_cutover_generation_batches
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
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Fail closed if durable generation evidence exists. row_security=off
  // either exposes all rows for the migration role or raises rather than
  // silently hiding evidence behind FORCE RLS.
  await knex.raw(`SET LOCAL row_security = off`);

  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM opening_inventory_cutover_generations
      LIMIT 1
    ) AS has_evidence
  `);

  if (Boolean(result.rows?.[0]?.has_evidence)) {
    throw new Error(
      '[OPENING_INVENTORY_CUTOVER_GENERATION_ROLLBACK_BLOCKED] durable generation evidence exists'
    );
  }

  await knex.raw(`
    DROP TRIGGER IF EXISTS
      opening_inventory_cutover_generations_no_delete
      ON opening_inventory_cutover_generations;

    DROP TRIGGER IF EXISTS
      opening_inventory_cutover_generations_frozen_at_commit
      ON opening_inventory_cutover_generations;

    DROP TRIGGER IF EXISTS
      opening_inventory_cutover_generations_freeze_guard
      ON opening_inventory_cutover_generations;

    DROP TRIGGER IF EXISTS
      opening_inventory_cutover_generation_entries_immutable
      ON opening_inventory_cutover_generation_entries;

    DROP TRIGGER IF EXISTS
      opening_inventory_cutover_generation_batches_immutable
      ON opening_inventory_cutover_generation_batches;

    DROP TRIGGER IF EXISTS
      opening_inventory_cutover_generation_entries_insert_guard
      ON opening_inventory_cutover_generation_entries;

    DROP TRIGGER IF EXISTS
      opening_inventory_cutover_generation_batches_insert_guard
      ON opening_inventory_cutover_generation_batches;

    DROP TRIGGER IF EXISTS
      opening_inventory_cutover_generations_insert_guard
      ON opening_inventory_cutover_generations;

    DROP FUNCTION IF EXISTS
      prevent_opening_inventory_cutover_generation_delete();

    DROP FUNCTION IF EXISTS
      assert_opening_inventory_cutover_generation_frozen_at_commit();

    DROP FUNCTION IF EXISTS
      guard_opening_inventory_cutover_generation_freeze();

    DROP FUNCTION IF EXISTS
      prevent_opening_inventory_cutover_generation_child_mutation();

    DROP FUNCTION IF EXISTS
      guard_opening_inventory_cutover_generation_child_insert();

    DROP FUNCTION IF EXISTS
      guard_opening_inventory_cutover_generation_insert();

    DROP TABLE IF EXISTS opening_inventory_cutover_generation_batches;
    DROP TABLE IF EXISTS opening_inventory_cutover_generation_entries;
    DROP TABLE IF EXISTS opening_inventory_cutover_generations;
  `);
}
