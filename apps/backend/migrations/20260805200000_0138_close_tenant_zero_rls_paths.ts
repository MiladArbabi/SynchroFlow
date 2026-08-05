import type { Knex } from 'knex';

/**
 * MIGRATION 0138 — close_tenant_zero_rls_paths
 * ------------------------------------------------
 * Forward repair for the merge-readiness findings discovered after 0137.
 *
 * 0137 deliberately established the restricted runtime role and repaired the
 * production tables found by the original probe. A wider review then proved
 * that older split policies still treated tenant 0 / missing tenant context as
 * a cross-tenant read mode. This migration removes that implicit mode and
 * replaces every legitimate pre-tenant operation with a narrow
 * SECURITY DEFINER function.
 *
 * This migration is intentionally forward-only. Reverting it would restore
 * cross-tenant visibility to credential, membership, billing, and worker
 * control-plane tables.
 */
export async function up(knex: Knex): Promise<void> {
  const tenantExpression = `
    shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
    AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
  `;
  const shopExpression = `
    id = NULLIF(current_setting('app.current_tenant', true), '')::integer
    AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
  `;

  await knex.raw(`
    DROP POLICY IF EXISTS shops_tenant_isolation_policy ON shops;
    DROP POLICY IF EXISTS shops_select_tenant_isolation ON shops;
    DROP POLICY IF EXISTS shops_update_tenant_isolation ON shops;
    DROP POLICY IF EXISTS shops_delete_tenant_isolation ON shops;
    DROP POLICY IF EXISTS shops_insert_open ON shops;

    CREATE POLICY shops_tenant_isolation_policy
      ON shops FOR ALL
      USING (${shopExpression})
      WITH CHECK (${shopExpression});
  `);

  const policyDefinitions = [
    {
      table: 'users',
      policies: [
        'users_tenant_isolation_policy',
        'users_select_tenant_isolation',
        'users_update_tenant_isolation',
        'users_delete_tenant_isolation',
        'users_insert_open',
      ],
      policy: 'users_tenant_isolation_policy',
    },
    {
      table: 'refresh_tokens',
      policies: [
        'refresh_tokens_tenant_isolation_policy',
        'refresh_tokens_select_policy',
        'refresh_tokens_write_policy',
      ],
      policy: 'refresh_tokens_tenant_isolation_policy',
    },
    {
      table: 'shop_memberships',
      policies: [
        'shop_memberships_tenant_isolation_policy',
        'shop_memberships_select_policy',
        'shop_memberships_write_policy',
      ],
      policy: 'shop_memberships_tenant_isolation_policy',
    },
    {
      table: 'shop_subscriptions',
      policies: [
        'shop_subscriptions_tenant_isolation_policy',
        'shop_subscriptions_select_policy',
        'shop_subscriptions_write_policy',
      ],
      policy: 'shop_subscriptions_tenant_isolation_policy',
    },
    {
      table: 'shop_module_entitlements',
      policies: [
        'shop_module_entitlements_tenant_isolation_policy',
        'shop_module_entitlements_select_policy',
        'shop_module_entitlements_write_policy',
      ],
      policy: 'shop_module_entitlements_tenant_isolation_policy',
    },
    {
      table: 'commands',
      policies: [
        'commands_tenant_isolation',
        'commands_select_policy',
        'commands_write_policy',
      ],
      policy: 'commands_tenant_isolation_policy',
    },
    {
      table: 'decision_execution_queue',
      policies: [
        'decision_execution_queue_isolation',
        'decision_execution_queue_select_policy',
        'decision_execution_queue_write_policy',
      ],
      policy: 'decision_execution_queue_tenant_isolation_policy',
    },
    {
      table: 'order_reconciliation_intents',
      policies: [
        'order_reconciliation_intents_tenant_isolation_policy',
        'order_reconciliation_intents_select_policy',
        'order_reconciliation_intents_write_policy',
      ],
      policy: 'order_reconciliation_intents_tenant_isolation_policy',
    },
    {
      table: 'user_lifecycle_snapshot',
      policies: [
        'user_lifecycle_snapshot_tenant_isolation_policy',
        'user_lifecycle_snapshot_select_policy',
        'user_lifecycle_snapshot_write_policy',
      ],
      policy: 'user_lifecycle_snapshot_tenant_isolation_policy',
    },
    {
      table: 'shop_carrier_webhook_tokens',
      policies: [
        'shop_carrier_webhook_tokens_select_policy',
        'shop_carrier_webhook_tokens_write_policy',
        'shop_carrier_webhook_tokens_tenant_isolation_policy',
      ],
      policy: 'shop_carrier_webhook_tokens_tenant_isolation_policy',
    },
  ];

  for (const definition of policyDefinitions) {
    await knex.raw('ALTER TABLE ?? ENABLE ROW LEVEL SECURITY', [definition.table]);
    await knex.raw('ALTER TABLE ?? FORCE ROW LEVEL SECURITY', [definition.table]);

    for (const policy of definition.policies) {
      await knex.raw('DROP POLICY IF EXISTS ?? ON ??', [policy, definition.table]);
    }

    await knex.raw(
      `CREATE POLICY ?? ON ?? FOR ALL USING (${tenantExpression}) WITH CHECK (${tenantExpression})`,
      [definition.policy, definition.table]
    );
  }

  /**
   * Tenant creation is the only legitimate write before a tenant identifier
   * exists. The function returns only the generated identifier; all dependent
   * writes immediately continue under that tenant in the caller's transaction.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.create_tenant_shop(p_name text)
    RETURNS integer
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      INSERT INTO public.shops (name)
      VALUES (p_name)
      RETURNING id
    $$;

    REVOKE ALL ON FUNCTION public.create_tenant_shop(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.create_tenant_shop(text) TO sf_app;
  `);

  /**
   * Authentication resolvers expose only the fields needed by one public auth
   * operation. They never expose verification/reset tokens through the email
   * lookup, and all lookup keys are normalized email addresses or high-entropy
   * token hashes.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.auth_email_exists(p_email text)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.users AS app_user
        WHERE app_user.email = pg_catalog.lower(p_email)
      )
    $$;

    CREATE OR REPLACE FUNCTION public.resolve_auth_user_by_email(p_email text)
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT pg_catalog.jsonb_build_object(
        'id', app_user.id,
        'shop_id', app_user.shop_id,
        'email', app_user.email,
        'password_hash', app_user.password_hash,
        'first_name', app_user.first_name,
        'last_name', app_user.last_name,
        'created_at', app_user.created_at,
        'updated_at', app_user.updated_at,
        'preferred_mode', app_user.preferred_mode,
        'detected_mode', app_user.detected_mode,
        'shopify_connected', app_user.shopify_connected,
        'stripe_connected', app_user.stripe_connected,
        'email_verified_at', app_user.email_verified_at,
        'entry_channel', app_user.entry_channel,
        'profile_prompt_dismissed_at', app_user.profile_prompt_dismissed_at
      )
      FROM public.users AS app_user
      WHERE app_user.email = pg_catalog.lower(p_email)
      LIMIT 1
    $$;

    CREATE OR REPLACE FUNCTION public.resolve_email_verification_user(
      p_token text
    )
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT pg_catalog.jsonb_build_object(
        'id', app_user.id,
        'shop_id', app_user.shop_id,
        'email_verified_at', app_user.email_verified_at,
        'email_verification_expires_at', app_user.email_verification_expires_at
      )
      FROM public.users AS app_user
      WHERE app_user.email_verification_token = p_token
      LIMIT 1
    $$;

    CREATE OR REPLACE FUNCTION public.resolve_password_reset_user(
      p_token text
    )
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT pg_catalog.jsonb_build_object(
        'id', app_user.id,
        'shop_id', app_user.shop_id,
        'password_reset_expires_at', app_user.password_reset_expires_at
      )
      FROM public.users AS app_user
      WHERE app_user.password_reset_token = p_token
      LIMIT 1
    $$;

    CREATE OR REPLACE FUNCTION public.resolve_refresh_token(
      p_token_hash text,
      p_session_id uuid,
      p_token_version integer
    )
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT pg_catalog.jsonb_build_object(
        'id', token.id,
        'user_id', token.user_id,
        'shop_id', token.shop_id,
        'session_id', token.session_id,
        'token_version', token.token_version,
        'expires_at', token.expires_at,
        'revoked_at', token.revoked_at
      )
      FROM public.refresh_tokens AS token
      WHERE token.token_hash = p_token_hash
        AND token.session_id = p_session_id
        AND token.token_version = p_token_version
      LIMIT 1
    $$;

    CREATE OR REPLACE FUNCTION public.revoke_refresh_token(p_token_hash text)
    RETURNS boolean
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      WITH revoked AS (
        UPDATE public.refresh_tokens AS token
        SET revoked_at = pg_catalog.now()
        WHERE token.token_hash = p_token_hash
          AND token.revoked_at IS NULL
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM revoked)
    $$;

    CREATE OR REPLACE FUNCTION public.resolve_active_shop_memberships(
      p_user_id integer
    )
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT COALESCE(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'shopId', membership.shop_id,
            'role', membership.role,
            'displayCurrency', membership.display_currency,
            'locale', membership.locale
          )
          ORDER BY membership.id
        ),
        '[]'::jsonb
      )
      FROM public.shop_memberships AS membership
      WHERE membership.user_id = p_user_id
        AND membership.revoked_at IS NULL
    $$;
  `);

  /**
   * Cross-tenant workers receive only bounded pending work. Mutations and all
   * related domain reads still execute under withTenant(row.shop_id).
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.list_pending_commands(
      p_limit integer DEFAULT 50
    )
    RETURNS SETOF jsonb
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT pg_catalog.jsonb_build_object(
        'id', command.id,
        'type', command.type,
        'payload', command.payload,
        'shop_id', command.shop_id,
        'status', command.status
      )
      FROM public.commands AS command
      WHERE command.status = 'pending'
      ORDER BY command.created_at
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    $$;

    CREATE OR REPLACE FUNCTION public.list_pending_decision_executions(
      p_limit integer DEFAULT 50
    )
    RETURNS SETOF jsonb
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT pg_catalog.jsonb_build_object(
        'id', execution.id,
        'decision_id', execution.decision_id,
        'shop_id', execution.shop_id,
        'status', execution.status,
        'created_at', execution.created_at
      )
      FROM public.decision_execution_queue AS execution
      WHERE execution.status = 'pending'
      ORDER BY execution.created_at
      LIMIT LEAST(GREATEST(p_limit, 1), 100)
    $$;

    CREATE OR REPLACE FUNCTION public.resolve_carrier_webhook_token(
      p_token_hash text,
      p_carrier_code text
    )
    RETURNS jsonb
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      SELECT pg_catalog.jsonb_build_object(
        'id', token.id,
        'shop_id', token.shop_id
      )
      FROM public.shop_carrier_webhook_tokens AS token
      WHERE token.token_hash = p_token_hash
        AND token.carrier_code = p_carrier_code
      LIMIT 1
    $$;
  `);

  const functionSignatures = [
    'auth_email_exists(text)',
    'resolve_auth_user_by_email(text)',
    'resolve_email_verification_user(text)',
    'resolve_password_reset_user(text)',
    'resolve_refresh_token(text, uuid, integer)',
    'revoke_refresh_token(text)',
    'resolve_active_shop_memberships(integer)',
    'list_pending_commands(integer)',
    'list_pending_decision_executions(integer)',
    'resolve_carrier_webhook_token(text, text)',
  ];

  for (const signature of functionSignatures) {
    await knex.raw(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC`);
    await knex.raw(`GRANT EXECUTE ON FUNCTION public.${signature} TO sf_app`);
  }
}

export async function down(_knex: Knex): Promise<void> {
  throw new Error(
    'SECURITY_MIGRATION_IRREVERSIBLE: rollback would restore tenant-zero RLS access'
  );
}
