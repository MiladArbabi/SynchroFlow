import type { Knex } from 'knex';

// GH-1101 — durable explicit manual recovery of a FAILED Shopify sync.
//
// 0212/0215/0216 are immutable. This migration evolves ONLY
// claim_shopify_sync_dispatch_outbox: a FAILED integration's latest, unconsumed
// intent becomes dispatchable for source 'recovery' (an explicit merchant
// request) in addition to 'install'. The 0216 one-time start fact, the claim
// lease, backoff, rate limit, supersession and tenant join are unchanged.
// No table, column, grant, owner, trigger or policy changes.
//
// Self-contained (type-only imports): the protected runner requires the 0216
// postconditions before UP and these evolved postconditions after it.
export const config = { transaction: true };

export const FINALIZER_SIGNATURE =
  'shopify_reconnect_private.finalize_reconnect(integer,integer,text,text,bigint,uuid,text,text,timestamp with time zone,timestamp with time zone,text,text,text,text)';

// ── Unchanged T3-A / T3-B authority, copied verbatim from 0216 ──────────────
const ROLE_BOUNDARY = `
  DO $boundary$
  DECLARE e pg_catalog.pg_roles%ROWTYPE; o pg_catalog.pg_roles%ROWTYPE;
  BEGIN
    SELECT * INTO e FROM pg_catalog.pg_roles WHERE rolname = 'sf_shopify_reconnect_executor';
    SELECT * INTO o FROM pg_catalog.pg_roles WHERE rolname = 'sf_shopify_reconnect_owner';
    IF e.oid IS NULL OR o.oid IS NULL OR NOT e.rolcanlogin OR o.rolcanlogin
       OR e.rolsuper OR e.rolbypassrls OR e.rolcreaterole OR e.rolcreatedb OR e.rolreplication
       OR o.rolsuper OR o.rolbypassrls OR o.rolcreaterole OR o.rolcreatedb OR o.rolreplication
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sf_app'
                      AND NOT rolsuper AND NOT rolbypassrls)
    THEN RAISE EXCEPTION 'RECONNECT_ROLE_ATTRIBUTES_INVALID'; END IF;

    -- No membership edge in either direction: neither inherited authority nor
    -- SET/ADMIN delegation can make O's trigger identity caller-forgeable.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
               WHERE member IN (e.oid, o.oid) OR roleid IN (e.oid, o.oid))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datdba IN (e.oid, o.oid))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner IN (e.oid, o.oid))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class
                  WHERE relowner IN (e.oid, o.oid))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc
                  WHERE proowner = e.oid OR (proowner = o.oid AND oid <>
                    COALESCE(pg_catalog.to_regprocedure('${FINALIZER_SIGNATURE}')::oid, 0)))
    THEN RAISE EXCEPTION 'RECONNECT_ROLE_OWNERSHIP_OR_MEMBERSHIP_INVALID'; END IF;

    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname !~ '^pg_toast' AND n.nspname !~ '^pg_temp'
        AND c.relkind IN ('r','p','v','m','f')
        AND (pg_catalog.has_table_privilege(e.oid, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(e.oid, c.oid, 'INSERT,UPDATE,REFERENCES'))
    ) OR pg_catalog.has_schema_privilege(e.oid, 'public', 'CREATE')
      OR pg_catalog.has_schema_privilege(o.oid, 'public', 'CREATE')
    THEN RAISE EXCEPTION 'RECONNECT_DIRECT_WRITE_OR_CREATE_AUTHORITY_INVALID'; END IF;

    IF (SELECT count(*) FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ('shops','shopify_app_installations','shopify_admin_credentials','integrations')
          AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relforcerowsecurity
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid)) <> 4
    THEN RAISE EXCEPTION 'RECONNECT_FORCED_RLS_REQUIRED'; END IF;
  END;
  $boundary$;
`;

function transitionFunction(allowFinalizer: boolean): string {
  return `
    CREATE OR REPLACE FUNCTION public.enforce_sync_status_transition()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
    SET search_path = pg_catalog, pg_temp
    AS $transition$
    BEGIN
      ${allowFinalizer ? `
      IF current_user = 'sf_shopify_reconnect_owner'
         AND session_user = 'sf_shopify_reconnect_executor'
         AND NEW.sync_status = 'PENDING'
         AND NEW.sync_progress_current = 0 AND NEW.sync_progress_total = 0
         AND NEW.sync_last_error IS NULL
         AND NEW.id = OLD.id AND NEW.shop_id = OLD.shop_id
         AND OLD.platform = 'shopify' AND NEW.platform = OLD.platform
         AND NEW.platform_shop_name IS NOT DISTINCT FROM OLD.platform_shop_name
      THEN RETURN NEW; END IF;` : ''}
      IF OLD.sync_status = 'COMPLETED' AND NEW.sync_status <> 'COMPLETED' THEN
        RAISE EXCEPTION 'integrations.sync_status cannot regress after COMPLETED';
      END IF;
      IF NOT (
        (OLD.sync_status = 'PENDING' AND NEW.sync_status = 'SYNCING_PRODUCTS') OR
        (OLD.sync_status = 'SYNCING_PRODUCTS' AND NEW.sync_status IN ('SYNCING_ORDERS','FAILED')) OR
        (OLD.sync_status = 'SYNCING_ORDERS' AND NEW.sync_status IN ('COMPLETED','FAILED')) OR
        (OLD.sync_status = 'SYNCING_PRODUCTS' AND NEW.sync_status = 'SYNCING_INVENTORY') OR
        (OLD.sync_status = 'SYNCING_INVENTORY' AND NEW.sync_status = 'SYNCING_SHOP') OR
        (OLD.sync_status = 'SYNCING_SHOP' AND NEW.sync_status = 'COMPLETING') OR
        (OLD.sync_status = 'COMPLETING' AND NEW.sync_status IN ('COMPLETED','FAILED')) OR
        (OLD.sync_status = 'FAILED' AND NEW.sync_status = 'SYNCING_PRODUCTS') OR
        (OLD.sync_status = NEW.sync_status)
      ) THEN
        RAISE EXCEPTION 'Illegal sync_status transition: % → %', OLD.sync_status, NEW.sync_status;
      END IF;
      RETURN NEW;
    END;
    $transition$;
  `;
}

const PRIORITY_FUNCTIONS = `
  CREATE OR REPLACE FUNCTION public.set_order_priority_flag(
    p_lasyncro_order_id uuid, p_flagged boolean
  ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $priority$
  BEGIN
    SET LOCAL "synchroflow.projection" = 'true';
    UPDATE public.order_fulfillment_status
    SET is_priority_flagged = p_flagged,
        priority_flagged_at = CASE WHEN p_flagged THEN NOW() ELSE priority_flagged_at END,
        updated_at = NOW()
    WHERE lasyncro_order_id = p_lasyncro_order_id;
  END;
  $priority$;

  CREATE OR REPLACE FUNCTION public.clear_priority_flag_on_batch(
    p_lasyncro_order_ids uuid[]
  ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $priority$
  BEGIN
    SET LOCAL "synchroflow.projection" = 'true';
    UPDATE public.order_fulfillment_status
    SET is_priority_flagged = false, updated_at = NOW()
    WHERE lasyncro_order_id = ANY(p_lasyncro_order_ids) AND is_priority_flagged = true;
  END;
  $priority$;

  REVOKE ALL ON FUNCTION public.set_order_priority_flag(uuid,boolean),
    public.clear_priority_flag_on_batch(uuid[])
    FROM PUBLIC, sf_shopify_reconnect_executor, sf_shopify_reconnect_owner;
  GRANT EXECUTE ON FUNCTION public.set_order_priority_flag(uuid,boolean),
    public.clear_priority_flag_on_batch(uuid[]) TO sf_app;
`;

const INTENT_EVENT_COLUMNS = ['shop_id', 'event_type', 'event_payload', 'event_time',
  'event_version', 'external_event_id'] as const;

// The shared outbox trigger (SECURITY INVOKER) runs as O: its ON CONFLICT
// arbiter reads domain_event_outbox.domain_event_id, and the outbox SELECT
// policy it then evaluates reads domain_events (id, shop_id) under O's own
// privileges and the finalizer's tenant. Those column reads are the minimum.
const INTENT_EVENT_READ_COLUMNS = ['id', 'shop_id'] as const;

// The finalizer runs with search_path = pg_catalog, pg_temp, so the AFTER
// INSERT outbox trigger it fires (SECURITY INVOKER, acting as O) must resolve
// its target by schema. Body otherwise identical to 0062.
function outboxTriggerFunction(qualified: boolean): string {
  return `
    CREATE OR REPLACE FUNCTION public.auto_create_domain_event_outbox()
    RETURNS trigger AS $$
    BEGIN
      -- TRACE: emit structural execution proof
      RAISE NOTICE 'OUTBOX_TRIGGER txid=%, pid=%, domain_event_id=%',
        txid_current(),
        pg_backend_pid(),
        NEW.id;

      INSERT INTO ${qualified ? 'public.' : ''}domain_event_outbox (domain_event_id)
      VALUES (NEW.id)
      ON CONFLICT (domain_event_id) DO NOTHING;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;
}

// Generic marker path: identical to 0157 except the dedicated intent is excluded.
const DISPATCH_BATCH = `
    CREATE OR REPLACE FUNCTION public.dispatch_domain_event_outbox_batch(
      p_limit integer DEFAULT 20
    )
    RETURNS TABLE (outbox_id bigint, domain_event_id bigint)
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $batch$
      WITH candidates AS (
        SELECT outbox.id
        FROM public.domain_event_outbox AS outbox
        JOIN public.domain_events AS event
          ON event.id = outbox.domain_event_id
        WHERE outbox.published_at IS NULL
          AND event.event_type <> 'billing/overage'
          AND event.event_type <> 'integration/sync_dispatch_requested'
        ORDER BY outbox.id
        LIMIT LEAST(GREATEST(p_limit, 1), 100)
        FOR UPDATE OF outbox SKIP LOCKED
      )
      UPDATE public.domain_event_outbox AS outbox
      SET published_at = pg_catalog.now(),
          last_error = NULL
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox.domain_event_id
    $batch$;
`;

// ── GH-1101: the only evolved function ───────────────────────────────────────
const DISPATCH_CLAIM = `
    CREATE OR REPLACE FUNCTION public.claim_shopify_sync_dispatch_outbox()
    RETURNS TABLE (
      outbox_id bigint,
      domain_event_id bigint,
      shop_id integer,
      integration_id integer,
      retry_count integer,
      recovery boolean
    )
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $claim$
      WITH candidate AS (
        SELECT
          outbox.id AS outbox_id,
          event.id AS domain_event_id,
          event.shop_id,
          integration.id AS integration_id,
          (outbox.published_at IS NOT NULL) AS recovery
        FROM public.domain_event_outbox AS outbox
        JOIN public.domain_events AS event
          ON event.id = outbox.domain_event_id
        JOIN public.integrations AS integration
          ON integration.shop_id = event.shop_id
         AND integration.id::text = (event.event_payload ->> 'integration_id')
         AND integration.platform = 'shopify'
         AND (
           integration.sync_status = 'PENDING'
           OR (integration.sync_status = 'FAILED'
               AND (event.event_payload ->> 'source') IN ('install', 'recovery'))
         )
        WHERE event.event_type = 'integration/sync_dispatch_requested'
          AND NOT EXISTS (
            SELECT 1
            FROM public.domain_events AS consumed
            WHERE consumed.shop_id = event.shop_id
              AND consumed.external_event_id =
                  'internal:integration/sync_cycle_started:' || event.id::text
          )
          AND (
            outbox.processing_at IS NULL
            OR outbox.processing_at < pg_catalog.now() - interval '2 minutes'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.domain_events AS newer
            WHERE newer.shop_id = event.shop_id
              AND newer.event_type = 'integration/sync_dispatch_requested'
              AND (newer.event_payload ->> 'integration_id') = (event.event_payload ->> 'integration_id')
              AND newer.id > event.id
          )
          AND (
            (
              outbox.published_at IS NULL
              AND (
                outbox.last_attempt_at IS NULL
                OR outbox.last_attempt_at <=
                   pg_catalog.now() -
                   pg_catalog.make_interval(
                     secs => LEAST(
                       300,
                       5 * pg_catalog.power(2, LEAST(outbox.retry_count, 6))::integer
                     )
                   )
              )
            )
            OR (
              outbox.published_at IS NOT NULL
              AND outbox.last_attempt_at <=
                  pg_catalog.now() -
                  pg_catalog.make_interval(
                    secs => LEAST(
                      3600,
                      300 * pg_catalog.power(2, LEAST(outbox.retry_count, 4))::integer
                    )
                  )
            )
          )
        ORDER BY outbox.id
        LIMIT 1
        FOR UPDATE OF outbox SKIP LOCKED
      )
      UPDATE public.domain_event_outbox AS outbox
      SET processing_at = pg_catalog.now(),
          first_attempt_at = COALESCE(outbox.first_attempt_at, pg_catalog.now()),
          last_attempt_at = pg_catalog.now(),
          retry_count = outbox.retry_count + CASE WHEN candidate.recovery THEN 1 ELSE 0 END
      FROM candidate
      WHERE outbox.id = candidate.outbox_id
      RETURNING
        outbox.id,
        candidate.domain_event_id,
        candidate.shop_id,
        candidate.integration_id,
        outbox.retry_count,
        candidate.recovery
    $claim$;
`;

// The exact 0216 claim, restored by DOWN.
const DISPATCH_CLAIM_0216 = `
    CREATE OR REPLACE FUNCTION public.claim_shopify_sync_dispatch_outbox()
    RETURNS TABLE (
      outbox_id bigint,
      domain_event_id bigint,
      shop_id integer,
      integration_id integer,
      retry_count integer,
      recovery boolean
    )
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $claim$
      WITH candidate AS (
        SELECT
          outbox.id AS outbox_id,
          event.id AS domain_event_id,
          event.shop_id,
          integration.id AS integration_id,
          (outbox.published_at IS NOT NULL) AS recovery
        FROM public.domain_event_outbox AS outbox
        JOIN public.domain_events AS event
          ON event.id = outbox.domain_event_id
        JOIN public.integrations AS integration
          ON integration.shop_id = event.shop_id
         AND integration.id::text = (event.event_payload ->> 'integration_id')
         AND integration.platform = 'shopify'
         AND (
           integration.sync_status = 'PENDING'
           OR (integration.sync_status = 'FAILED'
               AND (event.event_payload ->> 'source') = 'install')
         )
        WHERE event.event_type = 'integration/sync_dispatch_requested'
          AND NOT EXISTS (
            SELECT 1
            FROM public.domain_events AS consumed
            WHERE consumed.shop_id = event.shop_id
              AND consumed.external_event_id =
                  'internal:integration/sync_cycle_started:' || event.id::text
          )
          AND (
            outbox.processing_at IS NULL
            OR outbox.processing_at < pg_catalog.now() - interval '2 minutes'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.domain_events AS newer
            WHERE newer.shop_id = event.shop_id
              AND newer.event_type = 'integration/sync_dispatch_requested'
              AND (newer.event_payload ->> 'integration_id') = (event.event_payload ->> 'integration_id')
              AND newer.id > event.id
          )
          AND (
            (
              outbox.published_at IS NULL
              AND (
                outbox.last_attempt_at IS NULL
                OR outbox.last_attempt_at <=
                   pg_catalog.now() -
                   pg_catalog.make_interval(
                     secs => LEAST(
                       300,
                       5 * pg_catalog.power(2, LEAST(outbox.retry_count, 6))::integer
                     )
                   )
              )
            )
            OR (
              outbox.published_at IS NOT NULL
              AND outbox.last_attempt_at <=
                  pg_catalog.now() -
                  pg_catalog.make_interval(
                    secs => LEAST(
                      3600,
                      300 * pg_catalog.power(2, LEAST(outbox.retry_count, 4))::integer
                    )
                  )
            )
          )
        ORDER BY outbox.id
        LIMIT 1
        FOR UPDATE OF outbox SKIP LOCKED
      )
      UPDATE public.domain_event_outbox AS outbox
      SET processing_at = pg_catalog.now(),
          first_attempt_at = COALESCE(outbox.first_attempt_at, pg_catalog.now()),
          last_attempt_at = pg_catalog.now(),
          retry_count = outbox.retry_count + CASE WHEN candidate.recovery THEN 1 ELSE 0 END
      FROM candidate
      WHERE outbox.id = candidate.outbox_id
      RETURNING
        outbox.id,
        candidate.domain_event_id,
        candidate.shop_id,
        candidate.integration_id,
        outbox.retry_count,
        candidate.recovery
    $claim$;
`;

// Only a claimed sync intent can be marked; billing and other rows never match.
const DISPATCH_MARK = `
    CREATE OR REPLACE FUNCTION public.mark_shopify_sync_dispatch_outbox_published(
      p_outbox_id bigint
    )
    RETURNS boolean
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $mark$
      WITH marked AS (
        UPDATE public.domain_event_outbox AS outbox
        SET published_at = pg_catalog.now(),
            processing_at = NULL,
            last_error = NULL
        FROM public.domain_events AS event
        WHERE outbox.id = p_outbox_id
          AND event.id = outbox.domain_event_id
          AND event.event_type = 'integration/sync_dispatch_requested'
          AND outbox.processing_at IS NOT NULL
        RETURNING outbox.id
      )
      SELECT EXISTS (SELECT 1 FROM marked)
    $mark$;
`;

const DISPATCH_FAILURE = `
    CREATE OR REPLACE FUNCTION public.record_shopify_sync_dispatch_outbox_failure(
      p_outbox_id bigint,
      p_error text
    )
    RETURNS boolean
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $failure$
      WITH recorded AS (
        UPDATE public.domain_event_outbox AS outbox
        SET processing_at = NULL,
            retry_count = outbox.retry_count + 1,
            last_error = LEFT(COALESCE(p_error, 'unknown sync dispatch error'), 2000)
        FROM public.domain_events AS event
        WHERE outbox.id = p_outbox_id
          AND event.id = outbox.domain_event_id
          AND event.event_type = 'integration/sync_dispatch_requested'
          AND outbox.processing_at IS NOT NULL
        RETURNING outbox.id
      )
      SELECT EXISTS (SELECT 1 FROM recorded)
    $failure$;
`;

const DISPATCH_FUNCTION_SIGNATURES = [
  'public.dispatch_domain_event_outbox_batch(integer)',
  'public.claim_shopify_sync_dispatch_outbox()',
  'public.mark_shopify_sync_dispatch_outbox_published(bigint)',
  'public.record_shopify_sync_dispatch_outbox_failure(bigint,text)',
] as const;

const CLAIM_ACL = `
    REVOKE ALL ON FUNCTION public.claim_shopify_sync_dispatch_outbox()
      FROM PUBLIC, sf_shopify_reconnect_executor, sf_shopify_reconnect_owner;
    GRANT EXECUTE ON FUNCTION public.claim_shopify_sync_dispatch_outbox() TO sf_app;
`;

function finalizerDefinition(): string {
  return `
    CREATE OR REPLACE FUNCTION shopify_reconnect_private.finalize_reconnect(
      p_shop_id integer, p_installation_id integer, p_shop_domain text,
      p_installation_state text, p_generation bigint, p_lease_token uuid,
      p_access_token_encrypted text, p_refresh_token_encrypted text,
      p_access_expires_at timestamptz, p_refresh_expires_at timestamptz,
      p_granted_scopes text, p_shop_gid text, p_currency text, p_timezone text
    ) RETURNS TABLE (generation bigint, integration_id integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    SET app.current_tenant = ''
    AS $finalizer$
    DECLARE installation public.shopify_app_installations%ROWTYPE;
            credential public.shopify_admin_credentials%ROWTYPE;
            integration public.integrations%ROWTYPE;
            affected integer;
            expected_owner_rejection boolean := false;
    BEGIN
      IF session_user <> 'sf_shopify_reconnect_executor'
         OR current_user <> 'sf_shopify_reconnect_owner'
         OR p_shop_id IS NULL OR p_shop_id <= 0
         OR p_installation_id IS NULL OR p_installation_id <= 0
         OR p_generation IS NULL OR p_generation < 0 OR p_lease_token IS NULL
         OR p_installation_state IS NULL OR p_installation_state NOT IN ('ACTIVE','UNINSTALLED')
         OR p_shop_domain IS NULL OR octet_length(p_shop_domain) > 255
         OR p_shop_domain !~ '^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$'
         OR p_shop_gid IS NULL OR octet_length(p_shop_gid) > 255
         OR p_shop_gid !~ '^gid://shopify/Shop/[0-9]+$'
         OR p_access_token_encrypted IS NULL OR octet_length(p_access_token_encrypted) NOT BETWEEN 1 AND 65536
         OR p_refresh_token_encrypted IS NULL OR octet_length(p_refresh_token_encrypted) NOT BETWEEN 1 AND 65536
         OR p_access_expires_at IS NULL OR NOT isfinite(p_access_expires_at)
         OR p_refresh_expires_at IS NULL OR NOT isfinite(p_refresh_expires_at)
         OR p_granted_scopes IS NULL OR octet_length(p_granted_scopes) NOT BETWEEN 1 AND 16384
         OR (p_currency IS NOT NULL AND p_currency !~ '^[A-Z]{3}$')
         OR (p_timezone IS NOT NULL AND octet_length(p_timezone) NOT BETWEEN 1 AND 255)
      THEN RAISE EXCEPTION 'SHOPIFY_RECONNECT_INPUT_INVALID'; END IF;

      -- Identical key and argument types to canonical T2; no provider work here.
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('shopify_admin_credential_rotation'), p_shop_id);
      PERFORM pg_catalog.set_config('app.current_tenant', p_shop_id::text, true);
      PERFORM 1 FROM public.shops WHERE id = p_shop_id FOR UPDATE;
      IF NOT FOUND THEN
        expected_owner_rejection := true;
        RAISE EXCEPTION 'SHOPIFY_RECONNECT_OWNER_MISMATCH';
      END IF;
      SELECT * INTO installation FROM public.shopify_app_installations
        WHERE id = p_installation_id AND shop_id = p_shop_id AND shop_domain = p_shop_domain FOR UPDATE;
      IF NOT FOUND OR (p_installation_state = 'ACTIVE' AND installation.uninstalled_at IS NOT NULL)
         OR (p_installation_state = 'UNINSTALLED' AND installation.uninstalled_at IS NULL)
         OR (installation.shop_gid IS NOT NULL AND installation.shop_gid <> p_shop_gid)
      THEN
        expected_owner_rejection := true;
        RAISE EXCEPTION 'SHOPIFY_RECONNECT_OWNER_MISMATCH';
      END IF;
      SELECT * INTO credential FROM public.shopify_admin_credentials
        WHERE shop_id = p_shop_id AND installation_id = p_installation_id FOR UPDATE;
      IF NOT FOUND OR credential.credential_state <> 'REAUTH_REQUIRED'
         OR credential.credential_generation IS DISTINCT FROM p_generation
         OR credential.rotation_lease_token IS DISTINCT FROM p_lease_token
      THEN
        expected_owner_rejection := true;
        RAISE EXCEPTION 'SHOPIFY_RECONNECT_OWNER_MISMATCH';
      END IF;
      -- T2 ownership is the fenced epoch/token, not lease wall-clock expiry.
      -- An expired provider lease is stale only after a new owner replaces it.
      SELECT * INTO integration FROM public.integrations
        WHERE shop_id = p_shop_id AND platform = 'shopify' FOR UPDATE;
      IF FOUND AND integration.platform_shop_name IS DISTINCT FROM p_shop_domain
      THEN
        expected_owner_rejection := true;
        RAISE EXCEPTION 'SHOPIFY_RECONNECT_OWNER_MISMATCH';
      END IF;

      UPDATE public.shopify_admin_credentials
      SET access_token_encrypted = p_access_token_encrypted,
          refresh_token_encrypted = p_refresh_token_encrypted,
          access_expires_at = p_access_expires_at, refresh_expires_at = p_refresh_expires_at,
          granted_scopes = p_granted_scopes, credential_state = 'ACTIVE',
          rotation_lease_token = NULL, rotation_lease_expires_at = NULL, rotation_started_at = NULL,
          updated_at = transaction_timestamp()
      WHERE id = credential.id AND shop_id = p_shop_id AND installation_id = p_installation_id
        AND credential_state = 'REAUTH_REQUIRED' AND credential_generation = p_generation
        AND rotation_lease_token = p_lease_token;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN
        expected_owner_rejection := true;
        RAISE EXCEPTION 'SHOPIFY_RECONNECT_OWNER_MISMATCH';
      END IF;
      UPDATE public.shopify_app_installations
      SET shop_gid = p_shop_gid, scopes = p_granted_scopes, uninstalled_at = NULL,
          updated_at = transaction_timestamp()
      WHERE id = p_installation_id AND shop_id = p_shop_id AND shop_domain = p_shop_domain;
      IF NOT FOUND THEN
        expected_owner_rejection := true;
        RAISE EXCEPTION 'SHOPIFY_RECONNECT_OWNER_MISMATCH';
      END IF;
      UPDATE public.shops SET base_currency = COALESCE(p_currency, 'USD'),
        timezone = CASE WHEN timezone_source = 'shopify' AND p_timezone IS NOT NULL
                        THEN p_timezone ELSE timezone END
      WHERE id = p_shop_id;
      IF NOT FOUND THEN
        expected_owner_rejection := true;
        RAISE EXCEPTION 'SHOPIFY_RECONNECT_OWNER_MISMATCH';
      END IF;

      IF integration.id IS NULL THEN
        INSERT INTO public.integrations (shop_id, platform, platform_shop_name,
          sync_status, sync_progress_current, sync_progress_total, sync_last_error, updated_at)
        VALUES (p_shop_id, 'shopify', p_shop_domain, 'PENDING', 0, 0, NULL, transaction_timestamp())
        RETURNING id INTO integration_id;
      ELSE
        UPDATE public.integrations SET sync_status = 'PENDING', sync_progress_current = 0,
          sync_progress_total = 0, sync_last_error = NULL, updated_at = transaction_timestamp()
        WHERE id = integration.id AND shop_id = p_shop_id AND platform = 'shopify'
        RETURNING id INTO integration_id;
        IF NOT FOUND THEN
          expected_owner_rejection := true;
          RAISE EXCEPTION 'SHOPIFY_RECONNECT_OWNER_MISMATCH';
        END IF;
      END IF;
      -- GH-1068 T3-B: the fresh cycle's durable dispatch intent commits with
      -- credential activation and the PENDING reset, or nothing commits.
      INSERT INTO public.domain_events (shop_id, event_type, event_payload, event_time,
        event_version, external_event_id)
      VALUES (p_shop_id, 'integration/sync_dispatch_requested',
        pg_catalog.jsonb_build_object('integration_id', integration_id,
          'installation_id', p_installation_id, 'generation', p_generation::text,
          'source', 'reconnect'),
        pg_catalog.transaction_timestamp(), 1,
        'internal:integration/sync_dispatch_requested:' || integration_id::text
          || ':reconnect:' || p_generation::text);
      generation := p_generation; -- prepared epoch is never incremented again
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      IF expected_owner_rejection
         AND SQLSTATE = 'P0001'
         AND SQLERRM = 'SHOPIFY_RECONNECT_OWNER_MISMATCH' THEN
        RAISE EXCEPTION USING MESSAGE = 'SHOPIFY_RECONNECT_STALE_OWNER', ERRCODE = 'PZ101';
      END IF;
      -- Replace underlying SQL details: constraint errors can include ciphertext.
      RAISE EXCEPTION USING MESSAGE = 'SHOPIFY_RECONNECT_FINALIZATION_REJECTED', ERRCODE = 'P0001';
    END;
    $finalizer$;

    ALTER FUNCTION ${FINALIZER_SIGNATURE} OWNER TO sf_shopify_reconnect_owner;
    REVOKE ALL ON FUNCTION ${FINALIZER_SIGNATURE} FROM PUBLIC, sf_app, sf_shopify_reconnect_executor;
    GRANT EXECUTE ON FUNCTION ${FINALIZER_SIGNATURE} TO sf_shopify_reconnect_executor;
  `;
}

function body(definition: string, tag: string): string {
  return definition.split(tag)[1].replace(/'/g, "''");
}

async function assertDispatchAuthority(knex: Knex): Promise<void> {
  await knex.raw(ROLE_BOUNDARY);
  const expectedFinalizerBody = body(finalizerDefinition(), '$finalizer$');
  const expectedTransitionBody = body(transitionFunction(true), '$transition$');
  const expectedSetPriorityBody = PRIORITY_FUNCTIONS.split('$priority$')[1].replace(/'/g, "''");
  const expectedClearPriorityBody = PRIORITY_FUNCTIONS.split('$priority$')[3].replace(/'/g, "''");
  const expectedOutboxTriggerBody = body(outboxTriggerFunction(true), '$$');
  const expectedDispatchBodies: Record<string, string> = {
    [DISPATCH_FUNCTION_SIGNATURES[0]]: body(DISPATCH_BATCH, '$batch$'),
    [DISPATCH_FUNCTION_SIGNATURES[1]]: body(DISPATCH_CLAIM, '$claim$'),
    [DISPATCH_FUNCTION_SIGNATURES[2]]: body(DISPATCH_MARK, '$mark$'),
    [DISPATCH_FUNCTION_SIGNATURES[3]]: body(DISPATCH_FAILURE, '$failure$'),
  };
  await knex.raw(`
    DO $postconditions$
    DECLARE f pg_catalog.pg_proc%ROWTYPE; n pg_catalog.pg_namespace%ROWTYPE;
            p pg_catalog.pg_proc%ROWTYPE;
    BEGIN
      SELECT * INTO f FROM pg_catalog.pg_proc
        WHERE oid = pg_catalog.to_regprocedure('${FINALIZER_SIGNATURE}');
      SELECT * INTO n FROM pg_catalog.pg_namespace WHERE nspname = 'shopify_reconnect_private';
      IF f.oid IS NULL OR n.oid IS NULL OR NOT f.prosecdef
         OR f.proowner <> 'sf_shopify_reconnect_owner'::regrole
         OR (f.proconfig @> ARRAY['search_path=pg_catalog, pg_temp','row_security=on','app.current_tenant=']) IS DISTINCT FROM true
         OR f.prosrc IS DISTINCT FROM '${expectedFinalizerBody}'
         OR pg_catalog.has_schema_privilege('sf_shopify_reconnect_executor', n.oid, 'CREATE')
         OR pg_catalog.has_schema_privilege('sf_shopify_reconnect_owner', n.oid, 'CREATE')
         OR pg_catalog.has_schema_privilege('sf_app', n.oid, 'USAGE,CREATE')
         OR pg_catalog.has_function_privilege('sf_app', f.oid, 'EXECUTE')
         OR NOT pg_catalog.has_function_privilege('sf_shopify_reconnect_executor', f.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(f.proacl) a
                    WHERE a.grantee NOT IN (f.proowner, 'sf_shopify_reconnect_executor'::regrole)
                       OR a.privilege_type <> 'EXECUTE' OR a.is_grantable)
         OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(n.nspacl) a
                    WHERE a.grantee NOT IN (n.nspowner, 'sf_shopify_reconnect_executor'::regrole,
                                           'sf_shopify_reconnect_owner'::regrole)
                       OR (a.grantee <> n.nspowner AND (a.privilege_type <> 'USAGE' OR a.is_grantable)))
      THEN RAISE EXCEPTION 'RECONNECT_FINALIZER_ACL_INVALID'; END IF;

      IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = n.oid) <> 1
         OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relnamespace = n.oid)
         OR EXISTS (SELECT 1 FROM pg_catalog.pg_type
                    WHERE typnamespace = n.oid AND typisdefined)
      THEN RAISE EXCEPTION 'RECONNECT_PRIVATE_SCHEMA_CONTENTS_INVALID'; END IF;

      SELECT * INTO p FROM pg_catalog.pg_proc
        WHERE oid = 'public.enforce_sync_status_transition()'::regprocedure;
      IF p.prosecdef OR p.proowner IN ('sf_app'::regrole,
          'sf_shopify_reconnect_executor'::regrole, 'sf_shopify_reconnect_owner'::regrole)
         OR (p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) IS DISTINCT FROM true
         OR p.prosrc IS DISTINCT FROM '${expectedTransitionBody}'
         OR position('app.shopify_reconnect_' IN p.prosrc) > 0
         OR position('credential_generation' IN p.prosrc) > 0
         OR position('current_user = ''sf_shopify_reconnect_owner''' IN p.prosrc) = 0
         OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
                        WHERE tgrelid = 'public.integrations'::regclass
                          AND tgname = 'integrations_sync_transition_guard'
                          AND tgfoid = p.oid AND tgenabled IN ('O','A')
                          AND tgtype = 19 AND NOT tgisinternal)
      THEN RAISE EXCEPTION 'RECONNECT_TRANSITION_GUARD_INVALID'; END IF;

      FOR p IN SELECT * FROM pg_catalog.pg_proc WHERE oid IN (
        'public.set_order_priority_flag(uuid,boolean)'::regprocedure,
        'public.clear_priority_flag_on_batch(uuid[])'::regprocedure
      ) LOOP
        IF NOT p.prosecdef OR p.prorettype <> 'void'::regtype
           OR (p.proconfig @> ARRAY['search_path=pg_catalog, pg_temp']) IS DISTINCT FROM true
           OR (p.oid = 'public.set_order_priority_flag(uuid,boolean)'::regprocedure
               AND p.prosrc IS DISTINCT FROM '${expectedSetPriorityBody}')
           OR (p.oid = 'public.clear_priority_flag_on_batch(uuid[])'::regprocedure
               AND p.prosrc IS DISTINCT FROM '${expectedClearPriorityBody}')
           OR p.proowner IN ('sf_shopify_reconnect_executor'::regrole,'sf_shopify_reconnect_owner'::regrole)
           OR NOT pg_catalog.has_function_privilege('sf_app', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('sf_shopify_reconnect_executor', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('sf_shopify_reconnect_owner', p.oid, 'EXECUTE')
           OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) WHERE grantee = 0)
        THEN RAISE EXCEPTION 'PRIORITY_FUNCTION_AUTHORITY_INVALID'; END IF;
      END LOOP;

      IF EXISTS (
        SELECT 1 FROM (VALUES ('shops'),('shopify_app_installations'),
          ('shopify_admin_credentials'),('integrations')) required(table_name)
        WHERE NOT pg_catalog.has_table_privilege('sf_shopify_reconnect_owner',
          pg_catalog.to_regclass('public.' || required.table_name), 'SELECT')
      ) OR EXISTS (
        SELECT 1 FROM (VALUES
          ('shops','base_currency'), ('shops','timezone'),
          ('shopify_app_installations','shop_gid'), ('shopify_app_installations','scopes'),
          ('shopify_app_installations','uninstalled_at'), ('shopify_app_installations','updated_at'),
          ('shopify_admin_credentials','access_token_encrypted'),
          ('shopify_admin_credentials','refresh_token_encrypted'),
          ('shopify_admin_credentials','access_expires_at'), ('shopify_admin_credentials','refresh_expires_at'),
          ('shopify_admin_credentials','granted_scopes'), ('shopify_admin_credentials','credential_state'),
          ('shopify_admin_credentials','rotation_lease_token'), ('shopify_admin_credentials','rotation_lease_expires_at'),
          ('shopify_admin_credentials','rotation_started_at'), ('shopify_admin_credentials','updated_at'),
          ('integrations','sync_status'), ('integrations','sync_progress_current'),
          ('integrations','sync_progress_total'), ('integrations','sync_last_error'), ('integrations','updated_at')
        ) required(table_name, column_name)
        WHERE NOT pg_catalog.has_column_privilege('sf_shopify_reconnect_owner',
          pg_catalog.to_regclass('public.' || required.table_name), required.column_name, 'UPDATE')
      ) OR EXISTS (
        SELECT 1 FROM (VALUES ('shop_id'),('platform'),('platform_shop_name'),('sync_status'),
          ('sync_progress_current'),('sync_progress_total'),('sync_last_error'),('updated_at')) required(column_name)
        WHERE NOT pg_catalog.has_column_privilege('sf_shopify_reconnect_owner',
          'public.integrations', required.column_name, 'INSERT')
      ) OR pg_catalog.pg_get_serial_sequence('public.integrations', 'id') IS NULL
        OR NOT pg_catalog.has_sequence_privilege('sf_shopify_reconnect_owner',
          pg_catalog.pg_get_serial_sequence('public.integrations', 'id'), 'USAGE')
      THEN RAISE EXCEPTION 'RECONNECT_OWNER_OBJECT_ACL_INVALID'; END IF;

      -- T3-B: O may insert exactly the intent columns and read exactly the
      -- trigger/policy columns on the intent tables; no other relation outside
      -- the reconnect set is writable.
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.domain_events'::regclass AND a.attnum > 0 AND NOT a.attisdropped
          AND (pg_catalog.has_column_privilege('sf_shopify_reconnect_owner', a.attrelid, a.attnum, 'INSERT')
               IS DISTINCT FROM (a.attname = ANY (ARRAY['${INTENT_EVENT_COLUMNS.join("','")}']))
            OR pg_catalog.has_column_privilege('sf_shopify_reconnect_owner', a.attrelid, a.attnum, 'SELECT')
               IS DISTINCT FROM (a.attname = ANY (ARRAY['${INTENT_EVENT_READ_COLUMNS.join("','")}']))
            OR pg_catalog.has_column_privilege('sf_shopify_reconnect_owner', a.attrelid, a.attnum,
                 'UPDATE,REFERENCES'))
      ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = 'public.domain_event_outbox'::regclass AND a.attnum > 0 AND NOT a.attisdropped
          AND (pg_catalog.has_column_privilege('sf_shopify_reconnect_owner', a.attrelid, a.attnum, 'INSERT')
               IS DISTINCT FROM (a.attname = 'domain_event_id')
            OR pg_catalog.has_column_privilege('sf_shopify_reconnect_owner', a.attrelid, a.attnum, 'SELECT')
               IS DISTINCT FROM (a.attname = 'domain_event_id')
            OR pg_catalog.has_column_privilege('sf_shopify_reconnect_owner', a.attrelid, a.attnum,
                 'UPDATE,REFERENCES'))
      ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.oid IN ('public.domain_events'::regclass, 'public.domain_event_outbox'::regclass)
          AND (pg_catalog.has_table_privilege('sf_shopify_reconnect_owner', c.oid,
                 'INSERT,SELECT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR NOT c.relrowsecurity OR NOT c.relforcerowsecurity
            OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(c.relacl) acl WHERE acl.grantee = 0))
      ) OR EXISTS (
        SELECT 1 FROM (VALUES ('public.domain_events'), ('public.domain_event_outbox')) owned(table_name)
        WHERE pg_catalog.pg_get_serial_sequence(owned.table_name, 'id') IS NULL
           OR NOT pg_catalog.has_sequence_privilege('sf_shopify_reconnect_owner',
                pg_catalog.pg_get_serial_sequence(owned.table_name, 'id'), 'USAGE')
           OR pg_catalog.has_sequence_privilege('sf_shopify_reconnect_owner',
                pg_catalog.pg_get_serial_sequence(owned.table_name, 'id'), 'SELECT,UPDATE')
      ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
          AND ns.nspname !~ '^pg_toast' AND ns.nspname !~ '^pg_temp'
          AND c.relkind IN ('r','p','v','m','f')
          AND c.oid NOT IN ('public.shops'::regclass, 'public.shopify_app_installations'::regclass,
            'public.shopify_admin_credentials'::regclass, 'public.integrations'::regclass,
            'public.domain_events'::regclass, 'public.domain_event_outbox'::regclass)
          AND (pg_catalog.has_table_privilege('sf_shopify_reconnect_owner', c.oid,
                 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR pg_catalog.has_any_column_privilege('sf_shopify_reconnect_owner', c.oid,
                 'INSERT,UPDATE,REFERENCES'))
      ) THEN RAISE EXCEPTION 'RECONNECT_INTENT_AUTHORITY_INVALID'; END IF;

      -- Every trigger O can fire through the finalizer is pinned: the intent
      -- insert runs these as O (SECURITY INVOKER).
      SELECT * INTO p FROM pg_catalog.pg_proc
        WHERE oid = 'public.auto_create_domain_event_outbox()'::regprocedure;
      IF p.oid IS NULL OR p.prosecdef OR p.proconfig IS NOT NULL
         OR p.proowner IN ('sf_app'::regrole, 'sf_shopify_reconnect_executor'::regrole,
                           'sf_shopify_reconnect_owner'::regrole)
         OR p.prosrc IS DISTINCT FROM '${expectedOutboxTriggerBody}'
         OR (SELECT pg_catalog.array_agg(t.tgname::text || ':' || tn.nspname::text || '.'
                || tp.proname::text || ':' || t.tgtype::text || ':' || t.tgenabled::text ORDER BY t.tgname)
             FROM pg_catalog.pg_trigger t
             JOIN pg_catalog.pg_proc tp ON tp.oid = t.tgfoid
             JOIN pg_catalog.pg_namespace tn ON tn.oid = tp.pronamespace
             WHERE t.tgrelid = 'public.domain_events'::regclass AND NOT t.tgisinternal)
            IS DISTINCT FROM ARRAY[
              'domain_event_auto_outbox:public.auto_create_domain_event_outbox:5:O',
              'domain_events_no_delete:public.prevent_domain_event_mutation:11:O',
              'domain_events_no_update:public.prevent_domain_event_mutation:19:O']
         OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = 'public.domain_event_outbox'::regclass AND NOT t.tgisinternal)
         OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc m
                    WHERE m.oid = 'public.prevent_domain_event_mutation()'::regprocedure
                      AND (m.prosecdef OR m.proowner IN ('sf_app'::regrole,
                        'sf_shopify_reconnect_executor'::regrole, 'sf_shopify_reconnect_owner'::regrole)))
      THEN RAISE EXCEPTION 'RECONNECT_INTENT_TRIGGER_INVALID'; END IF;

      FOR p IN SELECT * FROM pg_catalog.pg_proc WHERE oid IN (
        '${DISPATCH_FUNCTION_SIGNATURES[0]}'::regprocedure,
        '${DISPATCH_FUNCTION_SIGNATURES[1]}'::regprocedure,
        '${DISPATCH_FUNCTION_SIGNATURES[2]}'::regprocedure,
        '${DISPATCH_FUNCTION_SIGNATURES[3]}'::regprocedure
      ) LOOP
        IF NOT p.prosecdef
           OR (p.proconfig @> ARRAY['search_path=pg_catalog, public']) IS DISTINCT FROM true
           OR p.proowner IN ('sf_app'::regrole, 'sf_shopify_reconnect_executor'::regrole,
                             'sf_shopify_reconnect_owner'::regrole)
           OR (p.oid = '${DISPATCH_FUNCTION_SIGNATURES[0]}'::regprocedure
               AND p.prosrc IS DISTINCT FROM '${expectedDispatchBodies[DISPATCH_FUNCTION_SIGNATURES[0]]}')
           OR (p.oid = '${DISPATCH_FUNCTION_SIGNATURES[1]}'::regprocedure
               AND p.prosrc IS DISTINCT FROM '${expectedDispatchBodies[DISPATCH_FUNCTION_SIGNATURES[1]]}')
           OR (p.oid = '${DISPATCH_FUNCTION_SIGNATURES[2]}'::regprocedure
               AND p.prosrc IS DISTINCT FROM '${expectedDispatchBodies[DISPATCH_FUNCTION_SIGNATURES[2]]}')
           OR (p.oid = '${DISPATCH_FUNCTION_SIGNATURES[3]}'::regprocedure
               AND p.prosrc IS DISTINCT FROM '${expectedDispatchBodies[DISPATCH_FUNCTION_SIGNATURES[3]]}')
           OR NOT pg_catalog.has_function_privilege('sf_app', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('sf_shopify_reconnect_executor', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('sf_shopify_reconnect_owner', p.oid, 'EXECUTE')
           OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                      WHERE a.grantee NOT IN (p.proowner, 'sf_app'::regrole)
                         OR a.privilege_type <> 'EXECUTE' OR a.is_grantable)
        THEN RAISE EXCEPTION 'SYNC_DISPATCH_FUNCTION_AUTHORITY_INVALID'; END IF;
      END LOOP;
      IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE oid IN (
            '${DISPATCH_FUNCTION_SIGNATURES[0]}'::regprocedure, '${DISPATCH_FUNCTION_SIGNATURES[1]}'::regprocedure,
            '${DISPATCH_FUNCTION_SIGNATURES[2]}'::regprocedure, '${DISPATCH_FUNCTION_SIGNATURES[3]}'::regprocedure)) <> 4
      THEN RAISE EXCEPTION 'SYNC_DISPATCH_FUNCTION_AUTHORITY_INVALID'; END IF;
    END;
    $postconditions$;
  `);
}

// Billing outbox functions (0157) must be untouched: exact bodies (md5 of the
// 0157 definitions), SECURITY DEFINER, search_path and an sf_app-only ACL.
const BILLING_POSTCONDITIONS = `
    DO $postconditions$
    DECLARE p pg_catalog.pg_proc%ROWTYPE;
    BEGIN
      IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE oid IN (
            'public.claim_billing_overage_outbox()'::regprocedure,
            'public.mark_billing_overage_outbox_published(bigint)'::regprocedure,
            'public.record_billing_overage_outbox_failure(bigint,text)'::regprocedure)) <> 3
      THEN RAISE EXCEPTION 'BILLING_OUTBOX_AUTHORITY_INVALID'; END IF;
      FOR p IN SELECT * FROM pg_catalog.pg_proc WHERE oid IN (
        'public.claim_billing_overage_outbox()'::regprocedure,
        'public.mark_billing_overage_outbox_published(bigint)'::regprocedure,
        'public.record_billing_overage_outbox_failure(bigint,text)'::regprocedure
      ) LOOP
        IF NOT p.prosecdef
           OR (p.proconfig @> ARRAY['search_path=pg_catalog, public']) IS DISTINCT FROM true
           OR p.proowner IN ('sf_app'::regrole, 'sf_shopify_reconnect_executor'::regrole,
                             'sf_shopify_reconnect_owner'::regrole)
           OR (p.oid = 'public.claim_billing_overage_outbox()'::regprocedure
               AND pg_catalog.md5(p.prosrc) IS DISTINCT FROM 'ba08bea8828b4d172cde363b897f7634')
           OR (p.oid = 'public.mark_billing_overage_outbox_published(bigint)'::regprocedure
               AND pg_catalog.md5(p.prosrc) IS DISTINCT FROM '5a9814140e77ae29fbd58a71947b2fc4')
           OR (p.oid = 'public.record_billing_overage_outbox_failure(bigint,text)'::regprocedure
               AND pg_catalog.md5(p.prosrc) IS DISTINCT FROM '1abc949c0438a1efe34107cf96192343')
           OR NOT pg_catalog.has_function_privilege('sf_app', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('sf_shopify_reconnect_executor', p.oid, 'EXECUTE')
           OR pg_catalog.has_function_privilege('sf_shopify_reconnect_owner', p.oid, 'EXECUTE')
           OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
                      WHERE a.grantee NOT IN (p.proowner, 'sf_app'::regrole)
                         OR a.privilege_type <> 'EXECUTE' OR a.is_grantable)
        THEN RAISE EXCEPTION 'BILLING_OUTBOX_AUTHORITY_INVALID'; END IF;
      END LOOP;
    END;
    $postconditions$;
`;

/** Independently defined GH-1101 postconditions, required by UP and the protected runner after 0217. */
export async function assertSecurityPostconditions(knex: Knex): Promise<void> {
  await assertDispatchAuthority(knex);
  await knex.raw(BILLING_POSTCONDITIONS);
}

export async function up(knex: Knex): Promise<void> {
  await knex.raw(ROLE_BOUNDARY);
  await knex.raw(DISPATCH_CLAIM + CLAIM_ACL);
  await assertSecurityPostconditions(knex);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(ROLE_BOUNDARY);
  await knex.raw(DISPATCH_CLAIM_0216 + CLAIM_ACL);
}
