import type { Knex } from 'knex';

/**
 * W1-B S1 — durable authorization identity and idempotent event foundation.
 *
 * Additive only: no legacy grant rows are copied and no subscription or
 * shop_module_entitlements state is changed. Runtime behavior lands in later
 * slices; this migration establishes only durable identity, tenant security,
 * relational integrity, history, and event immutability.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_authorizations', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable()
      .references('id').inTable('shops').onDelete('CASCADE');

    table.text('target_kind').notNullable();
    table.text('target_key').notNullable();
    table.text('authority_kind').notNullable();
    table.text('authority_ref').notNullable();
    table.text('lifecycle_owner_kind').notNullable();
    table.text('lifecycle_owner_ref').notNullable();

    table.timestamp('valid_from', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('valid_until', { useTz: true }).nullable();

    table.timestamp('revoked_at', { useTz: true }).nullable();
    table.text('revoked_by_kind').nullable();
    table.text('revoked_by_ref').nullable();
    table.text('revocation_reason').nullable();

    table.text('provider').nullable();
    table.text('provider_subscription_id').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Required by the event table's tenant-scoped composite foreign key.
    table.unique(['shop_id', 'id'], 'shop_authorizations_shop_id_id_unique');
  });

  await knex.raw(`
    ALTER TABLE shop_authorizations
      ADD CONSTRAINT shop_authorizations_target_kind_check
        CHECK (target_kind IN ('module', 'flag')),
      ADD CONSTRAINT shop_authorizations_target_key_check
        CHECK (char_length(target_key) BETWEEN 1 AND 255),
      ADD CONSTRAINT shop_authorizations_authority_identity_check
        CHECK (char_length(authority_kind) BETWEEN 1 AND 64
          AND char_length(authority_ref) BETWEEN 1 AND 255),
      ADD CONSTRAINT shop_authorizations_lifecycle_identity_check
        CHECK (char_length(lifecycle_owner_kind) BETWEEN 1 AND 64
          AND char_length(lifecycle_owner_ref) BETWEEN 1 AND 255),
      ADD CONSTRAINT shop_authorizations_interval_check
        CHECK (valid_until IS NULL OR valid_until > valid_from),
      ADD CONSTRAINT shop_authorizations_revocation_provenance_check
        CHECK (
          (revoked_at IS NULL AND revoked_by_kind IS NULL
            AND revoked_by_ref IS NULL AND revocation_reason IS NULL)
          OR
          (revoked_at IS NOT NULL AND revoked_by_kind IS NOT NULL
            AND revoked_by_kind ~ '[^[:space:]]'
            AND revoked_by_ref IS NOT NULL
            AND revoked_by_ref ~ '[^[:space:]]'
            AND revocation_reason IS NOT NULL
            AND revocation_reason ~ '[^[:space:]]'
            AND valid_until IS NOT NULL AND valid_until <= revoked_at)
        ),
      ADD CONSTRAINT shop_authorizations_provider_attribution_pair_check
        CHECK ((provider IS NULL) = (provider_subscription_id IS NULL)),
      ADD CONSTRAINT shop_authorizations_subscription_attribution_check
        CHECK (authority_kind <> 'subscription'
          OR (provider IS NOT NULL AND provider_subscription_id IS NOT NULL));

    CREATE UNIQUE INDEX shop_authorizations_open_authority_unique
      ON shop_authorizations
        (shop_id, target_kind, target_key, authority_kind, authority_ref)
      WHERE revoked_at IS NULL AND valid_until IS NULL;

    CREATE INDEX shop_authorizations_effective_target_idx
      ON shop_authorizations (shop_id, target_kind, target_key, valid_from, valid_until);

    CREATE INDEX shop_authorizations_lifecycle_owner_idx
      ON shop_authorizations
        (shop_id, lifecycle_owner_kind, lifecycle_owner_ref, revoked_at, valid_until);

    CREATE INDEX shop_authorizations_subscription_idx
      ON shop_authorizations (shop_id, provider, provider_subscription_id)
      WHERE provider_subscription_id IS NOT NULL;
  `);

  await knex.schema.createTable('shop_authorization_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id').notNullable()
      .references('id').inTable('shops').onDelete('CASCADE');
    table.text('authority_kind').notNullable();
    table.text('authority_ref').notNullable();
    table.text('source_event_key').notNullable();
    table.text('payload_hash').notNullable();
    table.text('event_kind').notNullable();
    table.text('target_kind').notNullable();
    table.text('target_key').notNullable();
    table.uuid('authorization_id').notNullable();
    table.timestamp('occurred_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(
      ['shop_id', 'authority_kind', 'authority_ref', 'source_event_key'],
      'shop_authorization_events_identity_unique'
    );
  });

  await knex.raw(`
    ALTER TABLE shop_authorization_events
      ADD CONSTRAINT shop_authorization_events_authorization_fk
        FOREIGN KEY (shop_id, authorization_id)
        REFERENCES shop_authorizations (shop_id, id)
        ON DELETE RESTRICT,
      ADD CONSTRAINT shop_authorization_events_authority_identity_check
        CHECK (char_length(authority_kind) BETWEEN 1 AND 64
          AND char_length(authority_ref) BETWEEN 1 AND 255),
      ADD CONSTRAINT shop_authorization_events_source_key_check
        CHECK (char_length(source_event_key) BETWEEN 1 AND 255),
      ADD CONSTRAINT shop_authorization_events_payload_hash_check
        CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
      ADD CONSTRAINT shop_authorization_events_event_kind_check
        CHECK (event_kind IN ('grant', 'revoke')),
      ADD CONSTRAINT shop_authorization_events_target_kind_check
        CHECK (target_kind IN ('module', 'flag')),
      ADD CONSTRAINT shop_authorization_events_target_key_check
        CHECK (char_length(target_key) BETWEEN 1 AND 255);

    CREATE INDEX shop_authorization_events_authorization_idx
      ON shop_authorization_events (shop_id, authorization_id, created_at);

    CREATE INDEX shop_authorization_events_history_idx
      ON shop_authorization_events (shop_id, created_at, id);
  `);

  const tenantExpression = `
    shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
    AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
  `;

  await knex.raw(`
    ALTER TABLE shop_authorizations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_authorizations FORCE ROW LEVEL SECURITY;

    CREATE POLICY shop_authorizations_select_policy
      ON shop_authorizations FOR SELECT TO sf_app
      USING (${tenantExpression});

    CREATE POLICY shop_authorizations_insert_policy
      ON shop_authorizations FOR INSERT TO sf_app
      WITH CHECK (${tenantExpression});

    CREATE POLICY shop_authorizations_update_policy
      ON shop_authorizations FOR UPDATE TO sf_app
      USING (${tenantExpression})
      WITH CHECK (${tenantExpression});

    REVOKE ALL ON shop_authorizations FROM PUBLIC, sf_app;
    GRANT SELECT, INSERT, UPDATE ON shop_authorizations TO sf_app;
    REVOKE DELETE ON shop_authorizations FROM sf_app;

    ALTER TABLE shop_authorization_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_authorization_events FORCE ROW LEVEL SECURITY;

    CREATE POLICY shop_authorization_events_select_policy
      ON shop_authorization_events FOR SELECT TO sf_app
      USING (${tenantExpression});

    CREATE POLICY shop_authorization_events_insert_policy
      ON shop_authorization_events FOR INSERT TO sf_app
      WITH CHECK (${tenantExpression});

    REVOKE ALL ON shop_authorization_events FROM PUBLIC, sf_app;
    GRANT SELECT, INSERT ON shop_authorization_events TO sf_app;
    REVOKE UPDATE, DELETE ON shop_authorization_events FROM sf_app;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_shop_authorization_identity_mutation()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id
        OR NEW.shop_id IS DISTINCT FROM OLD.shop_id
        OR NEW.target_kind IS DISTINCT FROM OLD.target_kind
        OR NEW.target_key IS DISTINCT FROM OLD.target_key
        OR NEW.authority_kind IS DISTINCT FROM OLD.authority_kind
        OR NEW.authority_ref IS DISTINCT FROM OLD.authority_ref
        OR NEW.lifecycle_owner_kind IS DISTINCT FROM OLD.lifecycle_owner_kind
        OR NEW.lifecycle_owner_ref IS DISTINCT FROM OLD.lifecycle_owner_ref
        OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
        OR NEW.provider IS DISTINCT FROM OLD.provider
        OR NEW.provider_subscription_id IS DISTINCT FROM OLD.provider_subscription_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
      THEN
        RAISE EXCEPTION
          '[IMMUTABILITY_VIOLATION] shop_authorizations durable identity is immutable.';
      END IF;
      -- Revocation is terminal: provenance and the closed interval are frozen.
      IF OLD.revoked_at IS NOT NULL AND (
        NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
        OR NEW.revoked_by_kind IS DISTINCT FROM OLD.revoked_by_kind
        OR NEW.revoked_by_ref IS DISTINCT FROM OLD.revoked_by_ref
        OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason
        OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
      ) THEN
        RAISE EXCEPTION
          '[REVOCATION_IMMUTABILITY] shop_authorizations revocation provenance is immutable.';
      END IF;
      -- Revoking closes at the earlier of the recorded expiration or revocation time.
      IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
        AND NEW.valid_until IS DISTINCT FROM LEAST(
          COALESCE(OLD.valid_until, NEW.revoked_at),
          NEW.revoked_at
        )
      THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = '[REVOCATION_IMMUTABILITY] shop_authorizations revocation must preserve canonical valid_until.';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER shop_authorizations_identity_immutable
      BEFORE UPDATE ON shop_authorizations
      FOR EACH ROW EXECUTE FUNCTION prevent_shop_authorization_identity_mutation();

    CREATE OR REPLACE FUNCTION prevent_shop_authorization_event_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[IMMUTABILITY_VIOLATION] shop_authorization_events is append-only. % is not allowed.',
        TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER shop_authorization_events_no_update
      BEFORE UPDATE ON shop_authorization_events
      FOR EACH ROW EXECUTE FUNCTION prevent_shop_authorization_event_mutation();

    CREATE TRIGGER shop_authorization_events_no_delete
      BEFORE DELETE ON shop_authorization_events
      FOR EACH ROW EXECUTE FUNCTION prevent_shop_authorization_event_mutation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS shop_authorization_events_no_delete
      ON shop_authorization_events;
    DROP TRIGGER IF EXISTS shop_authorization_events_no_update
      ON shop_authorization_events;
    DROP TRIGGER IF EXISTS shop_authorizations_identity_immutable
      ON shop_authorizations;
    DROP FUNCTION IF EXISTS prevent_shop_authorization_event_mutation();
    DROP FUNCTION IF EXISTS prevent_shop_authorization_identity_mutation();
  `);
  await knex.schema.dropTableIfExists('shop_authorization_events');
  await knex.schema.dropTableIfExists('shop_authorizations');
}
