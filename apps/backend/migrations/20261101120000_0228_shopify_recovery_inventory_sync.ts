import type { Knex } from 'knex';

/** S4-5 I4 — durable Shopify synchronisation of certified I3 recovery credits
 * (contract SF-S4-5-I4-CONTRACT-001 → NET-CORRECT-001 → DISPATCH-SAFETY-001;
 * OD1–OD7, N1–N5, CB1 + CB2 owner-ratified).
 *
 * A recovery credit is the I3 ledger row: inbound_purchase, reference_type
 * inventory_unit, triggered_by receive_recovery (0227 / I3). Inventory credit
 * itself is never read-modified here: no movement, truth or I3 object is written.
 *
 *   opening_inventory_recovery_capture_headers
 *   opening_inventory_recovery_capture_credits
 *       CB1 per-credit inclusion evidence. Written only inside the cutover
 *       generation's own REPEATABLE READ freeze transaction (generation still
 *       'assembling'), so a credit is captured ⇔ its +1 is in the frozen target.
 *       Insert-only. A generation without a header has NO evidence: absence is
 *       never exclusion (callers HOLD).
 *
 *   shopify_recovery_inventory_syncs
 *       one durable sync identity per credit (PK shop_id, credit_movement_id).
 *       Identity, idempotency key and reference URI immutable; the frozen
 *       request and first_dispatched_at are write-once; status transitions and
 *       the 23-hour automatic retry cutoff (N3) are enforced here; a credit is
 *       pushed only against a converged, captured baseline that does not
 *       include it, and skipped only when that baseline does include it.
 *       held_expired leaves only by maintenance-role reconciliation (N2).
 *
 * G0 (historical generations): a generation frozen before this migration gets
 * an empty 'migration_empty_backfill' header only if its shop has NO recovery
 * event and NO recovery movement while receive_held_recovery_events is held in
 * SHARE mode (I3 writes the event first in its credit transaction, so an
 * in-flight I3 credit is waited for, then seen). Events are append-only, so
 * zero now ⇒ zero in any earlier freeze snapshot. Any other historical
 * generation keeps no header and its shop's credits HOLD (N1/N5).
 */

const SYNC_STATUSES = [
  'held_no_baseline',
  'held_legacy_baseline',
  'held_no_capture',
  'skipped_included',
  'pending',
  'blocked_mapping',
  'blocked_credential',
  'dispatching',
  'ambiguous',
  'succeeded',
  'rejected',
  'held_expired',
] as const;

const sqlList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE opening_inventory_recovery_capture_headers (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      generation_id uuid NOT NULL,
      warehouse_id uuid NOT NULL,
      credit_count integer NOT NULL,
      source text NOT NULL,
      captured_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, generation_id),
      CONSTRAINT opening_inventory_recovery_capture_headers_generation_fk
        FOREIGN KEY (generation_id, shop_id)
        REFERENCES opening_inventory_cutover_generations (generation_id, shop_id)
        ON DELETE CASCADE,
      CONSTRAINT opening_inventory_recovery_capture_headers_count_nonnegative
        CHECK (credit_count >= 0),
      CONSTRAINT opening_inventory_recovery_capture_headers_source
        CHECK (source IN ('freeze', 'migration_empty_backfill')),
      CONSTRAINT opening_inventory_recovery_capture_headers_backfill_empty
        CHECK (source = 'freeze' OR credit_count = 0)
    );

    CREATE TABLE opening_inventory_recovery_capture_credits (
      shop_id integer NOT NULL,
      generation_id uuid NOT NULL,
      credit_movement_id uuid NOT NULL,
      location_code varchar(255) NOT NULL,
      PRIMARY KEY (shop_id, generation_id, credit_movement_id),
      CONSTRAINT opening_inventory_recovery_capture_credits_header_fk
        FOREIGN KEY (shop_id, generation_id)
        REFERENCES opening_inventory_recovery_capture_headers (shop_id, generation_id)
        ON DELETE CASCADE
    );

    -- Capture rows exist only for a generation still being assembled in its
    -- own freeze transaction (CB1); a backfilled header is migration-only.
    CREATE FUNCTION validate_opening_inventory_recovery_capture()
    RETURNS trigger AS $$
    DECLARE
      generation record;
    BEGIN
      SELECT status, warehouse_id INTO generation
        FROM opening_inventory_cutover_generations
       WHERE generation_id = NEW.generation_id AND shop_id = NEW.shop_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'RECOVERY_CAPTURE_GENERATION_MISSING: %', NEW.generation_id USING ERRCODE = 'P0001';
      END IF;

      IF TG_TABLE_NAME = 'opening_inventory_recovery_capture_headers' THEN
        IF NEW.warehouse_id <> generation.warehouse_id THEN
          RAISE EXCEPTION 'RECOVERY_CAPTURE_WAREHOUSE_MISMATCH: %', NEW.generation_id USING ERRCODE = 'P0001';
        END IF;
        IF NEW.source = 'migration_empty_backfill' THEN
          IF session_user = 'sf_app' THEN
            RAISE EXCEPTION 'RECOVERY_CAPTURE_BACKFILL_FORBIDDEN' USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END IF;
      ELSE
        IF NOT EXISTS (
          SELECT 1
            FROM inventory_movements m
            JOIN warehouse_locations wl
              ON wl.shop_id = m.shop_id AND wl.location_code = m.location_code
           WHERE m.shop_id = NEW.shop_id
             AND m.lasyncro_inventory_movement_id = NEW.credit_movement_id
             AND m.location_code = NEW.location_code
             AND m.movement_type::text = 'inbound_purchase'
             AND m.reference_type = 'inventory_unit'
             AND m.triggered_by = 'receive_recovery'
             AND wl.warehouse_id = generation.warehouse_id
        ) THEN
          RAISE EXCEPTION 'RECOVERY_CAPTURE_CREDIT_INVALID: %', NEW.credit_movement_id USING ERRCODE = 'P0001';
        END IF;
      END IF;

      IF generation.status <> 'assembling' THEN
        RAISE EXCEPTION 'RECOVERY_CAPTURE_GENERATION_NOT_ASSEMBLING: %', NEW.generation_id USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_recovery_capture_headers_validate
      BEFORE INSERT ON opening_inventory_recovery_capture_headers
      FOR EACH ROW EXECUTE FUNCTION validate_opening_inventory_recovery_capture();
    CREATE TRIGGER opening_inventory_recovery_capture_credits_validate
      BEFORE INSERT ON opening_inventory_recovery_capture_credits
      FOR EACH ROW EXECUTE FUNCTION validate_opening_inventory_recovery_capture();

    CREATE FUNCTION prevent_opening_inventory_recovery_capture_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION '% is insert-only. % is not allowed.', TG_TABLE_NAME, TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER opening_inventory_recovery_capture_headers_no_update
      BEFORE UPDATE ON opening_inventory_recovery_capture_headers
      FOR EACH ROW EXECUTE FUNCTION prevent_opening_inventory_recovery_capture_mutation();
    CREATE TRIGGER opening_inventory_recovery_capture_credits_no_update
      BEFORE UPDATE ON opening_inventory_recovery_capture_credits
      FOR EACH ROW EXECUTE FUNCTION prevent_opening_inventory_recovery_capture_mutation();
    -- Shop/generation cascades stay possible for maintenance roles only.
    CREATE FUNCTION prevent_opening_inventory_recovery_capture_delete()
    RETURNS trigger AS $$
    BEGIN
      IF session_user = 'sf_app' THEN
        RAISE EXCEPTION '% is insert-only. DELETE is not allowed.', TG_TABLE_NAME;
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER opening_inventory_recovery_capture_headers_no_delete
      BEFORE DELETE ON opening_inventory_recovery_capture_headers
      FOR EACH ROW EXECUTE FUNCTION prevent_opening_inventory_recovery_capture_delete();
    CREATE TRIGGER opening_inventory_recovery_capture_credits_no_delete
      BEFORE DELETE ON opening_inventory_recovery_capture_credits
      FOR EACH ROW EXECUTE FUNCTION prevent_opening_inventory_recovery_capture_delete();

    CREATE TABLE shopify_recovery_inventory_syncs (
      shop_id integer NOT NULL REFERENCES shops (id) ON DELETE CASCADE,
      credit_movement_id uuid NOT NULL,
      device_event_id uuid NOT NULL,
      lasyncro_unit_id varchar(20) NOT NULL,
      lasyncro_variant_id uuid NOT NULL,
      location_code varchar(255) NOT NULL,
      idempotency_key text NOT NULL,
      reference_document_uri text NOT NULL,
      status text NOT NULL,
      hold_reason text NULL,
      baseline_generation_id uuid NULL,
      request_inventory_item_gid text NULL,
      request_location_gid text NULL,
      request_payload_sha256 text NULL,
      request_frozen_at timestamptz NULL,
      first_dispatched_at timestamptz NULL,
      last_attempt_at timestamptz NULL,
      attempt_count integer NOT NULL DEFAULT 0,
      lease_token uuid NULL,
      lease_expires_at timestamptz NULL,
      provider_adjustment_group_gid text NULL,
      last_error text NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (shop_id, credit_movement_id),
      CONSTRAINT shopify_recovery_inventory_syncs_device_event_unique UNIQUE (shop_id, device_event_id),
      CONSTRAINT shopify_recovery_inventory_syncs_unit_unique UNIQUE (shop_id, lasyncro_unit_id),
      CONSTRAINT shopify_recovery_inventory_syncs_status CHECK (status IN (${sqlList(SYNC_STATUSES)})),
      CONSTRAINT shopify_recovery_inventory_syncs_request_shape CHECK (
        (request_inventory_item_gid IS NULL) = (request_location_gid IS NULL)
        AND (request_inventory_item_gid IS NULL) = (request_payload_sha256 IS NULL)
        AND (request_inventory_item_gid IS NULL) = (request_frozen_at IS NULL)
      ),
      CONSTRAINT shopify_recovery_inventory_syncs_sha_shape CHECK (
        request_payload_sha256 IS NULL OR request_payload_sha256 ~ '^[0-9a-f]{64}$'
      ),
      CONSTRAINT shopify_recovery_inventory_syncs_lease_shape CHECK (
        (lease_token IS NULL) = (lease_expires_at IS NULL)
      ),
      CONSTRAINT shopify_recovery_inventory_syncs_baseline_required CHECK (
        status NOT IN ('skipped_included', 'pending', 'blocked_mapping', 'blocked_credential',
                       'dispatching', 'ambiguous', 'succeeded', 'rejected', 'held_expired')
        OR baseline_generation_id IS NOT NULL
      ),
      CONSTRAINT shopify_recovery_inventory_syncs_dispatch_shape CHECK (
        status NOT IN ('dispatching', 'ambiguous', 'succeeded', 'rejected', 'held_expired')
        OR (request_payload_sha256 IS NOT NULL AND first_dispatched_at IS NOT NULL)
      ),
      CONSTRAINT shopify_recovery_inventory_syncs_dispatching_leased CHECK (
        status <> 'dispatching' OR lease_token IS NOT NULL
      )
      -- No FK to 0227 objects (0227 precedent: earlier DOWNs stay independent).
      -- The insert trigger proves the exact I3 ledger credit instead.
    );

    CREATE INDEX shopify_recovery_inventory_syncs_work_idx
      ON shopify_recovery_inventory_syncs (shop_id, status, last_attempt_at);

    CREATE FUNCTION enforce_shopify_recovery_inventory_sync()
    RETURNS trigger AS $$
    DECLARE
      converged boolean;
      header_present boolean;
      included boolean;
      allowed boolean;
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF NEW.shop_id <> OLD.shop_id
           OR NEW.credit_movement_id <> OLD.credit_movement_id
           OR NEW.device_event_id <> OLD.device_event_id
           OR NEW.lasyncro_unit_id <> OLD.lasyncro_unit_id
           OR NEW.lasyncro_variant_id <> OLD.lasyncro_variant_id
           OR NEW.location_code <> OLD.location_code
           OR NEW.idempotency_key <> OLD.idempotency_key
           OR NEW.reference_document_uri <> OLD.reference_document_uri
           OR NEW.created_at <> OLD.created_at THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_IDENTITY_IMMUTABLE' USING ERRCODE = 'P0001';
        END IF;
        IF OLD.request_payload_sha256 IS NOT NULL AND (
             NEW.request_payload_sha256 IS DISTINCT FROM OLD.request_payload_sha256
             OR NEW.request_inventory_item_gid IS DISTINCT FROM OLD.request_inventory_item_gid
             OR NEW.request_location_gid IS DISTINCT FROM OLD.request_location_gid
             OR NEW.request_frozen_at IS DISTINCT FROM OLD.request_frozen_at) THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_REQUEST_FROZEN' USING ERRCODE = 'P0001';
        END IF;
        IF OLD.first_dispatched_at IS NOT NULL
           AND NEW.first_dispatched_at IS DISTINCT FROM OLD.first_dispatched_at THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_FIRST_DISPATCH_IMMUTABLE' USING ERRCODE = 'P0001';
        END IF;
        IF OLD.baseline_generation_id IS NOT NULL
           AND NEW.baseline_generation_id IS DISTINCT FROM OLD.baseline_generation_id THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_BASELINE_IMMUTABLE' USING ERRCODE = 'P0001';
        END IF;

        IF NEW.status <> OLD.status THEN
          allowed := CASE
            WHEN OLD.status IN ('held_no_baseline', 'held_legacy_baseline', 'held_no_capture') THEN
              NEW.status IN ('held_no_baseline', 'held_legacy_baseline', 'held_no_capture', 'skipped_included', 'pending')
            WHEN OLD.status = 'pending' THEN
              NEW.status IN ('dispatching', 'blocked_mapping', 'blocked_credential')
            WHEN OLD.status IN ('blocked_mapping', 'blocked_credential') THEN
              NEW.status IN ('pending', 'blocked_mapping', 'blocked_credential')
            WHEN OLD.status = 'dispatching' THEN
              NEW.status IN ('succeeded', 'rejected', 'ambiguous')
            WHEN OLD.status = 'ambiguous' THEN
              NEW.status IN ('dispatching', 'held_expired', 'succeeded', 'rejected')
            -- N2: expired ambiguity leaves only through maintenance reconciliation.
            WHEN OLD.status = 'held_expired' THEN
              session_user <> 'sf_app' AND NEW.status IN ('succeeded', 'rejected')
            ELSE false
          END;
          IF NOT allowed THEN
            RAISE EXCEPTION 'RECOVERY_SYNC_TRANSITION_INVALID: % -> %', OLD.status, NEW.status USING ERRCODE = 'P0001';
          END IF;
        END IF;

        -- N3: automatic retry of an ambiguous request only within 23 hours of
        -- its first dispatch (Shopify's 24-hour idempotency window).
        IF OLD.status = 'ambiguous' AND NEW.status = 'dispatching'
           AND now() >= OLD.first_dispatched_at + interval '23 hours' THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_RETRY_WINDOW_EXPIRED' USING ERRCODE = 'P0001';
        END IF;
      ELSE
        IF NEW.status NOT IN ('held_no_baseline', 'held_legacy_baseline', 'held_no_capture', 'skipped_included', 'pending') THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_INITIAL_STATUS_INVALID: %', NEW.status USING ERRCODE = 'P0001';
        END IF;
        IF NEW.request_payload_sha256 IS NOT NULL OR NEW.first_dispatched_at IS NOT NULL OR NEW.lease_token IS NOT NULL THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_INITIAL_SHAPE_INVALID' USING ERRCODE = 'P0001';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM inventory_movements m
           WHERE m.shop_id = NEW.shop_id
             AND m.lasyncro_inventory_movement_id = NEW.credit_movement_id
             AND m.device_event_id = NEW.device_event_id
             AND m.lasyncro_variant_id = NEW.lasyncro_variant_id
             AND m.location_code = NEW.location_code
             AND m.movement_type::text = 'inbound_purchase'
             AND m.reference_type = 'inventory_unit'
             AND m.triggered_by = 'receive_recovery'
             AND m.quantity_delta = 1
        ) THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_CREDIT_INVALID: %', NEW.credit_movement_id USING ERRCODE = 'P0001';
        END IF;
      END IF;

      -- Baseline proof for every skip or push decision (CB1 evidence).
      IF NEW.status IN ('skipped_included', 'pending', 'dispatching')
         AND (TG_OP = 'INSERT' OR NEW.status <> OLD.status) THEN
        SELECT EXISTS (
          SELECT 1 FROM opening_inventory_cutover_executions e
            JOIN shop_wms_settings s ON s.shop_id = e.shop_id
           WHERE e.shop_id = NEW.shop_id AND e.generation_id = NEW.baseline_generation_id
             AND e.status = 'converged' AND s.opening_inventory_shopify_synced_at IS NOT NULL
        ) INTO converged;
        SELECT EXISTS (
          SELECT 1 FROM opening_inventory_recovery_capture_headers h
            JOIN warehouse_locations wl
              ON wl.shop_id = h.shop_id AND wl.warehouse_id = h.warehouse_id
           WHERE h.shop_id = NEW.shop_id AND h.generation_id = NEW.baseline_generation_id
             AND wl.location_code = NEW.location_code
        ) INTO header_present;
        SELECT EXISTS (
          SELECT 1 FROM opening_inventory_recovery_capture_credits c
           WHERE c.shop_id = NEW.shop_id AND c.generation_id = NEW.baseline_generation_id
             AND c.credit_movement_id = NEW.credit_movement_id
        ) INTO included;
        IF NOT converged OR NOT header_present THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_BASELINE_UNPROVEN: %', NEW.credit_movement_id USING ERRCODE = 'P0001';
        END IF;
        IF NEW.status = 'skipped_included' AND NOT included THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_SKIP_WITHOUT_INCLUSION: %', NEW.credit_movement_id USING ERRCODE = 'P0001';
        END IF;
        IF NEW.status IN ('pending', 'dispatching') AND included THEN
          RAISE EXCEPTION 'RECOVERY_SYNC_PUSH_OF_INCLUDED_CREDIT: %', NEW.credit_movement_id USING ERRCODE = 'P0001';
        END IF;
      END IF;

      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER shopify_recovery_inventory_syncs_enforce
      BEFORE INSERT OR UPDATE ON shopify_recovery_inventory_syncs
      FOR EACH ROW EXECUTE FUNCTION enforce_shopify_recovery_inventory_sync();

    CREATE FUNCTION prevent_shopify_recovery_inventory_sync_delete()
    RETURNS trigger AS $$
    BEGIN
      IF session_user = 'sf_app' THEN
        RAISE EXCEPTION 'shopify_recovery_inventory_syncs rows are durable. DELETE is not allowed.';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER shopify_recovery_inventory_syncs_no_delete
      BEFORE DELETE ON shopify_recovery_inventory_syncs
      FOR EACH ROW EXECUTE FUNCTION prevent_shopify_recovery_inventory_sync_delete();

    ALTER TABLE opening_inventory_recovery_capture_headers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE opening_inventory_recovery_capture_headers FORCE ROW LEVEL SECURITY;
    CREATE POLICY opening_inventory_recovery_capture_headers_tenant_isolation_policy
      ON opening_inventory_recovery_capture_headers
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);

    ALTER TABLE opening_inventory_recovery_capture_credits ENABLE ROW LEVEL SECURITY;
    ALTER TABLE opening_inventory_recovery_capture_credits FORCE ROW LEVEL SECURITY;
    CREATE POLICY opening_inventory_recovery_capture_credits_tenant_isolation_policy
      ON opening_inventory_recovery_capture_credits
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);

    ALTER TABLE shopify_recovery_inventory_syncs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shopify_recovery_inventory_syncs FORCE ROW LEVEL SECURITY;
    CREATE POLICY shopify_recovery_inventory_syncs_tenant_isolation_policy
      ON shopify_recovery_inventory_syncs
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);

    -- The schema default ACL would otherwise hand sf_app UPDATE/DELETE (0211 lesson).
    REVOKE ALL ON opening_inventory_recovery_capture_headers FROM sf_app;
    REVOKE ALL ON opening_inventory_recovery_capture_credits FROM sf_app;
    REVOKE ALL ON shopify_recovery_inventory_syncs FROM sf_app;
    GRANT SELECT, INSERT ON opening_inventory_recovery_capture_headers TO sf_app;
    GRANT SELECT, INSERT ON opening_inventory_recovery_capture_credits TO sf_app;
    GRANT SELECT, INSERT, UPDATE ON shopify_recovery_inventory_syncs TO sf_app;

    -- Cross-tenant work discovery only (0175 precedent); every read and write
    -- of a shop's credits then runs under that shop's tenant context and RLS.
    CREATE FUNCTION public.list_shopify_recovery_inventory_sync_tenants()
    RETURNS TABLE (shop_id integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT DISTINCT event.shop_id
        FROM public.receive_held_recovery_events AS event
       WHERE event.outcome = 'recovered'
         AND NOT EXISTS (
           SELECT 1 FROM public.shopify_recovery_inventory_syncs AS sync
            WHERE sync.shop_id = event.shop_id
              AND sync.device_event_id = event.device_event_id
              AND sync.status IN ('skipped_included', 'succeeded', 'rejected', 'held_expired')
         )
    $$;
    REVOKE ALL ON FUNCTION public.list_shopify_recovery_inventory_sync_tenants() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.list_shopify_recovery_inventory_sync_tenants() TO sf_app;
  `);

  // G0 — historical generations (see header). SHARE waits for any in-flight
  // I3 credit transaction, then blocks new ones until this migration commits.
  await knex.raw(`LOCK TABLE receive_held_recovery_events IN SHARE MODE`);
  await knex.raw(`SET LOCAL row_security = off`);
  await knex.raw(`
    INSERT INTO opening_inventory_recovery_capture_headers
      (shop_id, generation_id, warehouse_id, credit_count, source)
    SELECT g.shop_id, g.generation_id, g.warehouse_id, 0, 'migration_empty_backfill'
      FROM opening_inventory_cutover_generations g
     WHERE g.status = 'frozen'
       AND NOT EXISTS (
         SELECT 1 FROM receive_held_recovery_events e WHERE e.shop_id = g.shop_id
       )
       AND NOT EXISTS (
         SELECT 1 FROM inventory_movements m
          WHERE m.shop_id = g.shop_id AND m.triggered_by = 'receive_recovery'
       )
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Fail closed: durable sync evidence or freeze-time inclusion evidence wins
  // over rollback convenience. Lock first so none can be written meanwhile.
  await knex.raw(`
    LOCK TABLE shopify_recovery_inventory_syncs,
               opening_inventory_recovery_capture_headers,
               opening_inventory_recovery_capture_credits
      IN ACCESS EXCLUSIVE MODE
  `);
  await knex.raw(`SET LOCAL row_security = off`);
  const result = await knex.raw(`
    SELECT (
      EXISTS (SELECT 1 FROM shopify_recovery_inventory_syncs)
      OR EXISTS (SELECT 1 FROM opening_inventory_recovery_capture_headers WHERE source = 'freeze')
    ) AS blocked
  `);
  if (result.rows?.[0]?.blocked) {
    throw new Error('SHOPIFY_RECOVERY_INVENTORY_SYNC_ROLLBACK_BLOCKED: recovery sync or capture evidence exists');
  }

  await knex.raw(`
    DROP FUNCTION IF EXISTS public.list_shopify_recovery_inventory_sync_tenants();
    DROP TABLE shopify_recovery_inventory_syncs;
    DROP FUNCTION enforce_shopify_recovery_inventory_sync();
    DROP FUNCTION prevent_shopify_recovery_inventory_sync_delete();
    DROP TABLE opening_inventory_recovery_capture_credits;
    DROP TABLE opening_inventory_recovery_capture_headers;
    DROP FUNCTION validate_opening_inventory_recovery_capture();
    DROP FUNCTION prevent_opening_inventory_recovery_capture_mutation();
    DROP FUNCTION prevent_opening_inventory_recovery_capture_delete();
  `);
}
