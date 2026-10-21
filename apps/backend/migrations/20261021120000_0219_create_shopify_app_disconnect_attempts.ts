import type { Knex } from 'knex';

/**
 * GH-979 SECTION C — durable owner-initiated Shopify disconnect attempts.
 *
 * Additive only: one new tenant table. It touches no reconnect-authority
 * object, function, grant or existing table, and is ordered after 0218.
 *
 * An attempt pins the exact installation, credential generation and credential
 * material it acts on. Its status is the durable disconnect intent:
 *   CLAIMED            single-attempt lease; nothing irreversible sent yet
 *   UNINSTALL_SENT     intent recorded BEFORE the irreversible appUninstall
 *   OUTCOME_UNKNOWN    the mutation may have executed; never repeated
 *   PROVIDER_CONFIRMED Shopify confirmed; the pinned local fence is pending
 *   ABORTED | REJECTED | CONFIRMED | NOT_UNINSTALLED | SUPERSEDED  resolved
 *
 * provider_confirmed_at is durable provider evidence that arrived late (after
 * the sender's lease expired). It never touches another owner's lease; the
 * lease holder or the next claim promotes it to PROVIDER_CONFIRMED.
 *
 * Resolved attempts are immutable (trigger), so they can never regress into a
 * live state, and NOT_UNINSTALLED can never coexist with provider confirmation.
 *
 * At most one live attempt per tenant (partial unique index), across every
 * application instance. Leases are judged by database time, so crashed or
 * interrupted attempts expire instead of blocking forever. No credential
 * material or Shopify-authored text is stored: only expiry timestamps (for
 * material identity), the provider installation GID and an enum outcome code.
 *
 * Every read and write runs as sf_app under FORCE RLS. No DELETE grant.
 */
const LIVE = `('CLAIMED', 'UNINSTALL_SENT', 'OUTCOME_UNKNOWN', 'PROVIDER_CONFIRMED')`;
const RESOLVED = `('ABORTED', 'REJECTED', 'CONFIRMED', 'NOT_UNINSTALLED', 'SUPERSEDED')`;
const SENT = `('UNINSTALL_SENT', 'OUTCOME_UNKNOWN', 'PROVIDER_CONFIRMED', 'REJECTED', 'CONFIRMED', 'NOT_UNINSTALLED')`;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shopify_app_disconnect_attempts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable()
      .references('id').inTable('shops').onDelete('CASCADE');
    table.integer('installation_id').notNullable();
    table.text('shop_domain').notNullable();
    table.bigInteger('credential_generation').notNullable();
    table.timestamp('pinned_access_expires_at', { useTz: true }).nullable();
    table.timestamp('pinned_refresh_expires_at', { useTz: true }).nullable();
    table.text('provider_installation_gid').nullable();
    table.text('status').notNullable();
    table.uuid('claim_token').nullable();
    table.timestamp('lease_expires_at', { useTz: true }).nullable();
    table.timestamp('uninstall_sent_at', { useTz: true }).nullable();
    table.timestamp('resolved_at', { useTz: true }).nullable();
    table.text('outcome_code').nullable();
    table.timestamp('provider_confirmed_at', { useTz: true }).nullable();
    table.integer('reconcile_attempts').notNullable().defaultTo(0);
    table.timestamp('reconcile_last_attempt_at', { useTz: true }).nullable();
    table.timestamps(true, true);
    table.foreign(['installation_id', 'shop_id'], 'shopify_app_disconnect_attempts_installation_fk')
      .references(['id', 'shop_id']).inTable('shopify_app_installations').onDelete('CASCADE');
  });

  const tenantExpression = `
    shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
    AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
  `;

  await knex.raw(`
    ALTER TABLE shopify_app_disconnect_attempts
      ADD CONSTRAINT shopify_app_disconnect_attempts_status_check
      CHECK (status IN ${LIVE} OR status IN ${RESOLVED});

    ALTER TABLE shopify_app_disconnect_attempts
      ADD CONSTRAINT shopify_app_disconnect_attempts_resolution_check
      CHECK ((status IN ${RESOLVED}) = (resolved_at IS NOT NULL));

    ALTER TABLE shopify_app_disconnect_attempts
      ADD CONSTRAINT shopify_app_disconnect_attempts_intent_check
      CHECK (status NOT IN ${SENT} OR uninstall_sent_at IS NOT NULL);

    ALTER TABLE shopify_app_disconnect_attempts
      ADD CONSTRAINT shopify_app_disconnect_attempts_lease_check
      CHECK ((claim_token IS NULL) = (lease_expires_at IS NULL));

    ALTER TABLE shopify_app_disconnect_attempts
      ADD CONSTRAINT shopify_app_disconnect_attempts_generation_check
      CHECK (credential_generation >= 0);

    ALTER TABLE shopify_app_disconnect_attempts
      ADD CONSTRAINT shopify_app_disconnect_attempts_reconcile_attempts_check
      CHECK (reconcile_attempts >= 0);

    ALTER TABLE shopify_app_disconnect_attempts
      ADD CONSTRAINT shopify_app_disconnect_attempts_provider_confirmed_check
      CHECK (provider_confirmed_at IS NULL OR (uninstall_sent_at IS NOT NULL
        AND status NOT IN ('CLAIMED', 'ABORTED', 'REJECTED', 'NOT_UNINSTALLED')));

    ALTER TABLE shopify_app_disconnect_attempts
      ADD CONSTRAINT shopify_app_disconnect_attempts_outcome_code_check
      CHECK (outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{0,63}$');

    CREATE UNIQUE INDEX shopify_app_disconnect_attempts_one_live_idx
      ON shopify_app_disconnect_attempts (shop_id)
      WHERE status IN ${LIVE};

    ALTER TABLE shopify_app_disconnect_attempts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shopify_app_disconnect_attempts FORCE ROW LEVEL SECURITY;

    CREATE POLICY shopify_app_disconnect_attempts_select_policy
      ON shopify_app_disconnect_attempts FOR SELECT
      USING (${tenantExpression});

    CREATE POLICY shopify_app_disconnect_attempts_insert_policy
      ON shopify_app_disconnect_attempts FOR INSERT
      WITH CHECK (${tenantExpression});

    CREATE POLICY shopify_app_disconnect_attempts_update_policy
      ON shopify_app_disconnect_attempts FOR UPDATE
      USING (${tenantExpression})
      WITH CHECK (${tenantExpression});

    GRANT SELECT, INSERT, UPDATE ON shopify_app_disconnect_attempts TO sf_app;
    REVOKE DELETE ON shopify_app_disconnect_attempts FROM sf_app;

    CREATE FUNCTION public.shopify_app_disconnect_attempts_resolved_immutable()
    RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
    SET search_path = pg_catalog, pg_temp
    AS $immutable$
    BEGIN
      IF OLD.resolved_at IS NOT NULL THEN
        RAISE EXCEPTION 'SHOPIFY_DISCONNECT_ATTEMPT_RESOLVED_IMMUTABLE';
      END IF;
      RETURN NEW;
    END;
    $immutable$;

    REVOKE ALL ON FUNCTION public.shopify_app_disconnect_attempts_resolved_immutable() FROM PUBLIC;

    CREATE TRIGGER shopify_app_disconnect_attempts_resolved_immutable
      BEFORE UPDATE ON shopify_app_disconnect_attempts
      FOR EACH ROW EXECUTE FUNCTION public.shopify_app_disconnect_attempts_resolved_immutable();
  `);

  await knex.schema.createTable('shopify_uninstall_verifications', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');
    table.integer('webhook_event_id').notNullable().unique()
      .references('id').inTable('integration_webhook_events').onDelete('CASCADE');
    table.text('external_event_id').notNullable().unique();
    table.integer('observed_installation_id').nullable();
    table.bigInteger('observed_credential_generation').nullable();
    table.bigInteger('reconnect_event_watermark_id').nullable();
    table.text('owner_recovery_state_hash').nullable();
    table.text('shop_domain').notNullable();
    table.text('status').notNullable().defaultTo('PENDING');
    table.uuid('claim_token').nullable();
    table.timestamp('lease_expires_at', { useTz: true }).nullable();
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('outcome_code').nullable();
    table.timestamp('resolved_at', { useTz: true }).nullable();
    table.timestamps(true, true);
    table.foreign(['observed_installation_id', 'shop_id'], 'shopify_uninstall_verification_installation_fk')
      .references(['id', 'shop_id']).inTable('shopify_app_installations').onDelete('CASCADE');
    table.index(['status', 'next_attempt_at'], 'shopify_uninstall_verification_claim_idx');
    table.index(['shop_id', 'observed_installation_id'], 'shopify_uninstall_verification_authority_idx');
    table.unique(['id', 'shop_id'], 'shopify_uninstall_verification_shop_identity_key');
  });

  await knex.schema.createTable('shopify_uninstall_recovery_authorizations', (table) => {
    table.uuid('verification_id').notNullable();
    table.integer('shop_id').notNullable();
    table.text('oauth_state_hash').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['verification_id', 'oauth_state_hash'], 'shopify_uninstall_recovery_auth_pk');
    table.foreign(['verification_id', 'shop_id'], 'shopify_uninstall_recovery_auth_verification_fk')
      .references(['id', 'shop_id']).inTable('shopify_uninstall_verifications').onDelete('CASCADE');
    table.index(['shop_id', 'verification_id'], 'shopify_uninstall_recovery_auth_shop_idx');
  });

  await knex.raw(`
    ALTER TABLE shopify_uninstall_verifications
      ADD CONSTRAINT shopify_uninstall_verifications_status_check
      CHECK (status IN ('PENDING','PROCESSING','UNRESOLVED','CURRENT_AUTHORITY_VERIFIED','SUPERSEDED','ALREADY_UNINSTALLED'));
    ALTER TABLE shopify_uninstall_verifications
      ADD CONSTRAINT shopify_uninstall_verifications_lease_check
      CHECK ((status = 'PROCESSING') = (claim_token IS NOT NULL AND lease_expires_at IS NOT NULL));
    ALTER TABLE shopify_uninstall_verifications
      ADD CONSTRAINT shopify_uninstall_verifications_resolution_check
      CHECK ((status IN ('CURRENT_AUTHORITY_VERIFIED','SUPERSEDED','ALREADY_UNINSTALLED')) = (resolved_at IS NOT NULL));
    ALTER TABLE shopify_uninstall_verifications
      ADD CONSTRAINT shopify_uninstall_verifications_attempt_count_check CHECK (attempt_count >= 0);
    ALTER TABLE shopify_uninstall_verifications
      ADD CONSTRAINT shopify_uninstall_verifications_outcome_check
      CHECK (outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{0,63}$');
    ALTER TABLE shopify_uninstall_verifications
      ADD CONSTRAINT shopify_uninstall_verifications_order_unproven_check
      CHECK (outcome_code IS DISTINCT FROM 'ORDER_UNPROVEN' OR (
        status = 'UNRESOLVED'
        AND observed_installation_id IS NULL
        AND observed_credential_generation IS NULL
        AND reconnect_event_watermark_id IS NULL
      ));
    ALTER TABLE shopify_uninstall_verifications
      ADD CONSTRAINT shopify_uninstall_verifications_recovery_hash_check
      CHECK (owner_recovery_state_hash IS NULL OR owner_recovery_state_hash ~ '^[a-f0-9]{64}$');

    ALTER TABLE shopify_uninstall_verifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shopify_uninstall_verifications FORCE ROW LEVEL SECURITY;
    CREATE POLICY shopify_uninstall_verifications_select_policy
      ON shopify_uninstall_verifications FOR SELECT USING (${tenantExpression});
    CREATE POLICY shopify_uninstall_verifications_insert_policy
      ON shopify_uninstall_verifications FOR INSERT WITH CHECK (${tenantExpression});
    CREATE POLICY shopify_uninstall_verifications_update_policy
      ON shopify_uninstall_verifications FOR UPDATE USING (${tenantExpression}) WITH CHECK (${tenantExpression});
    GRANT SELECT, INSERT, UPDATE ON shopify_uninstall_verifications TO sf_app;
    REVOKE DELETE ON shopify_uninstall_verifications FROM sf_app;

    ALTER TABLE public.shopify_uninstall_recovery_authorizations
      ADD CONSTRAINT shopify_uninstall_recovery_auth_hash_check
      CHECK (oauth_state_hash ~ '^[a-f0-9]{64}$');
    ALTER TABLE public.shopify_uninstall_recovery_authorizations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.shopify_uninstall_recovery_authorizations FORCE ROW LEVEL SECURITY;
    CREATE POLICY shopify_uninstall_recovery_authorizations_select_policy
      ON public.shopify_uninstall_recovery_authorizations FOR SELECT TO sf_app
      USING (${tenantExpression});
    CREATE POLICY shopify_uninstall_recovery_authorizations_insert_policy
      ON public.shopify_uninstall_recovery_authorizations FOR INSERT
      WITH CHECK (${tenantExpression});
    REVOKE ALL ON public.shopify_uninstall_recovery_authorizations
      FROM PUBLIC, sf_app, sf_shopify_reconnect_executor, sf_shopify_reconnect_owner;
    GRANT SELECT ON public.shopify_uninstall_recovery_authorizations TO sf_app;

    CREATE FUNCTION public.issue_shopify_oauth_state_with_recovery(
      p_shop_id integer, p_user_id integer, p_state text,
      p_shop_domain text, p_expires_at timestamptz
    ) RETURNS TABLE(oauth_state_hash text, authorized_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    SET row_security = on
    SET app.current_tenant = ''
    AS $issue$
    DECLARE issued_count integer; bound_count integer;
            computed_hash text;
    BEGIN
      IF session_user <> 'sf_app'
         OR p_shop_id IS NULL OR p_shop_id <= 0
         OR p_user_id IS NULL OR p_user_id <= 0
         OR p_state IS NULL OR p_state !~ '^[a-f0-9]{32}$'
         OR p_shop_domain IS NULL
         OR p_shop_domain !~ '^[a-z0-9][a-z0-9-]*[.]myshopify[.]com$'
         OR p_expires_at IS NULL OR NOT pg_catalog.isfinite(p_expires_at)
         OR p_expires_at <= pg_catalog.now()
         OR p_expires_at > pg_catalog.now() + interval '10 minutes'
      THEN RAISE EXCEPTION 'SHOPIFY_OAUTH_ISSUANCE_INPUT_INVALID'; END IF;

      PERFORM pg_catalog.set_config('app.current_tenant', p_shop_id::text, true);
      computed_hash := pg_catalog.encode(
        public.digest(pg_catalog.convert_to(p_state, 'UTF8'), 'sha256'), 'hex');

      WITH authority AS MATERIALIZED (
        SELECT membership.role
        FROM public.shop_memberships AS membership
        JOIN public.shopify_app_installations AS installation
          ON installation.shop_id = membership.shop_id
         AND installation.shop_domain = p_shop_domain
        WHERE membership.shop_id = p_shop_id
          AND membership.user_id = p_user_id
          AND membership.revoked_at IS NULL
        LIMIT 1
      ), eligible AS MATERIALIZED (
        SELECT verification.id
        FROM public.shopify_uninstall_verifications AS verification
        WHERE verification.shop_id = p_shop_id
          AND verification.shop_domain = p_shop_domain
          AND verification.status = 'UNRESOLVED'
          AND verification.outcome_code = 'ORDER_UNPROVEN'
          AND EXISTS (SELECT 1 FROM authority WHERE authority.role = 'owner')
      ), issued AS (
        INSERT INTO public.integration_oauth_states
          (user_id, platform, state, shop_domain, expires_at, install_source)
        SELECT p_user_id, 'shopify', p_state, p_shop_domain, p_expires_at, 'reconnect'
        FROM authority
        RETURNING id
      ), authorized AS (
        INSERT INTO public.shopify_uninstall_recovery_authorizations
          (verification_id, shop_id, oauth_state_hash)
        SELECT eligible.id, p_shop_id, computed_hash
        FROM eligible CROSS JOIN issued
        WHERE true
        ON CONFLICT ON CONSTRAINT shopify_uninstall_recovery_auth_pk DO NOTHING
        RETURNING verification_id
      )
      SELECT (SELECT count(*)::integer FROM issued),
             (SELECT count(*)::integer FROM authorized)
      INTO issued_count, bound_count;

      IF issued_count <> 1 THEN
        RAISE EXCEPTION 'SHOPIFY_OAUTH_ISSUANCE_AUTHORITY_MISMATCH';
      END IF;
      oauth_state_hash := computed_hash;
      authorized_count := bound_count;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE = 'P0001' AND SQLERRM IN (
        'SHOPIFY_OAUTH_ISSUANCE_INPUT_INVALID',
        'SHOPIFY_OAUTH_ISSUANCE_AUTHORITY_MISMATCH'
      ) THEN RAISE; END IF;
      RAISE EXCEPTION USING MESSAGE = 'SHOPIFY_OAUTH_ISSUANCE_REJECTED', ERRCODE = 'P0001';
    END;
    $issue$;

    REVOKE ALL ON FUNCTION public.issue_shopify_oauth_state_with_recovery(
      integer, integer, text, text, timestamptz
    ) FROM PUBLIC, sf_shopify_reconnect_executor, sf_shopify_reconnect_owner;
    GRANT EXECUTE ON FUNCTION public.issue_shopify_oauth_state_with_recovery(
      integer, integer, text, text, timestamptz
    ) TO sf_app;

    CREATE FUNCTION public.claim_shopify_uninstall_verification()
    RETURNS TABLE(id uuid, shop_id integer, claim_token uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $claim$
    DECLARE claimed_id uuid; claimed_shop integer; token uuid := gen_random_uuid();
    BEGIN
      SELECT verification.id, verification.shop_id INTO claimed_id, claimed_shop
      FROM public.shopify_uninstall_verifications AS verification
      WHERE (
          verification.status IN ('PENDING','UNRESOLVED')
          AND verification.outcome_code IS DISTINCT FROM 'ORDER_UNPROVEN'
          AND verification.attempt_count < 5
          AND verification.next_attempt_at <= pg_catalog.now()
        ) OR (
          verification.status = 'PROCESSING'
          AND verification.lease_expires_at <= pg_catalog.now()
        )
      ORDER BY verification.created_at, verification.id
      FOR UPDATE SKIP LOCKED LIMIT 1;
      IF claimed_id IS NULL THEN RETURN; END IF;
      UPDATE public.shopify_uninstall_verifications AS verification
      SET status = 'PROCESSING', claim_token = token,
          lease_expires_at = pg_catalog.now() + interval '30 seconds',
          attempt_count = verification.attempt_count + 1,
          updated_at = pg_catalog.now()
      WHERE verification.id = claimed_id;
      RETURN QUERY SELECT claimed_id, claimed_shop, token;
    END;
    $claim$;
    REVOKE ALL ON FUNCTION public.claim_shopify_uninstall_verification() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.claim_shopify_uninstall_verification() TO sf_app;

    CREATE FUNCTION public.next_shopify_uninstall_recovery_shop()
    RETURNS TABLE(shop_id integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $recovery$
      SELECT verification.shop_id
      FROM public.shopify_uninstall_verifications AS verification
      JOIN public.integrations AS integration
        ON integration.shop_id = verification.shop_id
       AND integration.platform = 'shopify'
      WHERE verification.status IN ('PENDING','PROCESSING','UNRESOLVED')
        AND verification.outcome_code IS DISTINCT FROM 'ORDER_UNPROVEN'
        AND verification.reconnect_event_watermark_id IS NOT NULL
        AND verification.observed_installation_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.domain_events AS event
          WHERE event.shop_id = verification.shop_id
            AND event.event_type = 'integration/sync_dispatch_requested'
            AND event.id > verification.reconnect_event_watermark_id
            AND event.event_payload->>'source' = 'reconnect'
            AND event.event_payload->>'integration_id' = integration.id::text
            AND event.event_payload->>'installation_id' = verification.observed_installation_id::text
            AND event.event_payload->>'generation' ~ '^[0-9]+$'
        )
      ORDER BY verification.created_at, verification.id
      LIMIT 1
    $recovery$;
    REVOKE ALL ON FUNCTION public.next_shopify_uninstall_recovery_shop() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.next_shopify_uninstall_recovery_shop() TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP FUNCTION IF EXISTS public.next_shopify_uninstall_recovery_shop()');
  await knex.raw('DROP FUNCTION IF EXISTS public.claim_shopify_uninstall_verification()');
  await knex.raw(`DROP FUNCTION IF EXISTS public.issue_shopify_oauth_state_with_recovery(
    integer, integer, text, text, timestamptz)`);
  await knex.schema.dropTableIfExists('shopify_uninstall_recovery_authorizations');
  await knex.schema.dropTableIfExists('shopify_uninstall_verifications');
  await knex.schema.dropTableIfExists('shopify_app_disconnect_attempts');
  await knex.raw('DROP FUNCTION IF EXISTS public.shopify_app_disconnect_attempts_resolved_immutable()');
}
