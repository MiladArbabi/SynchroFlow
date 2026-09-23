import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notification_events', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');
    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    table
      .foreign(['shop_id', 'user_id'], 'notification_events_membership_fk')
      .references(['shop_id', 'user_id'])
      .inTable('shop_memberships')
      .onDelete('CASCADE');
    table.text('condition_key').notNullable();
    table.text('source_type').notNullable();
    table.text('source_id').nullable();
    table.text('occurrence_key').notNullable();
    table.text('source_fingerprint').notNullable();
    table.text('urgency').notNullable();
    table.text('title').notNullable();
    table.text('message').notNullable();
    table.jsonb('context_json').notNullable().defaultTo('{}');
    table.jsonb('action_json').nullable();
    table.timestamp('read_at', { useTz: true }).nullable();
    table.timestamp('clicked_at', { useTz: true }).nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(
      ['shop_id', 'user_id', 'occurrence_key'],
      'notification_events_shop_user_occurrence_unique',
    );
    table.index(
      ['shop_id', 'user_id', 'created_at'],
      'notification_events_recent_idx',
    );
    table.index(
      ['shop_id', 'user_id', 'created_at'],
      'notification_events_unread_recent_idx',
      {
        predicate: knex.whereNull('read_at'),
      },
    );
  });

  await knex.raw(`
    ALTER TABLE notification_events
      ADD CONSTRAINT notification_events_urgency_check
      CHECK (urgency IN ('critical', 'important', 'informational'));

    ALTER TABLE notification_events
      ENABLE ROW LEVEL SECURITY;

    ALTER TABLE notification_events
      FORCE ROW LEVEL SECURITY;

    CREATE POLICY notification_events_tenant_isolation_policy
      ON notification_events
      FOR ALL
      USING (
        shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
        AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
      )
      WITH CHECK (
        shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
        AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
      );
  `);

  await knex.schema.createTable('notification_deliveries', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table
      .uuid('notification_event_id')
      .notNullable()
      .references('id')
      .inTable('notification_events')
      .onDelete('CASCADE');
    table.text('channel').notNullable();
    table.text('status').notNullable();
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.text('provider_message_id').nullable();
    table.text('last_error').nullable();
    table.timestamp('next_attempt_at', { useTz: true }).nullable();
    table.timestamp('last_attempt_at', { useTz: true }).nullable();
    table.uuid('claim_token').nullable();
    table.timestamp('claim_expires_at', { useTz: true }).nullable();
    table.timestamp('sent_at', { useTz: true }).nullable();
    table.timestamp('delivered_at', { useTz: true }).nullable();
    table.timestamp('failed_at', { useTz: true }).nullable();
    table.timestamp('cancelled_at', { useTz: true }).nullable();
    table.text('terminal_reason').nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(
      ['notification_event_id', 'channel'],
      'notification_deliveries_event_channel_unique',
    );
    table.index(
      ['notification_event_id'],
      'notification_deliveries_event_idx',
    );
    table.index(
      ['status', 'next_attempt_at'],
      'notification_deliveries_due_idx',
    );
  });

  await knex.raw(`
    ALTER TABLE notification_deliveries
      ADD CONSTRAINT notification_deliveries_channel_check
      CHECK (channel IN ('in_app', 'push', 'email'));

    ALTER TABLE notification_deliveries
      ADD CONSTRAINT notification_deliveries_status_check
      CHECK (status IN ('queued', 'processing', 'sent', 'delivered', 'failed', 'cancelled'));

    ALTER TABLE notification_deliveries
      ADD CONSTRAINT notification_deliveries_attempt_count_check
      CHECK (attempt_count >= 0);

    ALTER TABLE notification_deliveries
      ENABLE ROW LEVEL SECURITY;

    ALTER TABLE notification_deliveries
      FORCE ROW LEVEL SECURITY;

    CREATE POLICY notification_deliveries_tenant_isolation_policy
      ON notification_deliveries
      FOR ALL
      USING (
        EXISTS (
          SELECT 1
          FROM notification_events
          WHERE notification_events.id = notification_deliveries.notification_event_id
            AND notification_events.shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
            AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM notification_events
          WHERE notification_events.id = notification_deliveries.notification_event_id
            AND notification_events.shop_id = NULLIF(current_setting('app.current_tenant', true), '')::integer
            AND NULLIF(current_setting('app.current_tenant', true), '')::integer > 0
        )
      );
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.claim_notification_deliveries(
      p_limit integer,
      p_lease_seconds integer
    )
    RETURNS TABLE (
      delivery_id uuid,
      shop_id integer,
      claim_token uuid
    )
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      WITH candidates AS (
        SELECT
          nd.id
        FROM public.notification_deliveries nd
        WHERE (
          nd.status = 'queued'
          AND (
            nd.next_attempt_at IS NULL
            OR nd.next_attempt_at <= now()
          )
        )
        OR (
          nd.status = 'processing'
          AND nd.claim_expires_at <= now()
        )
        ORDER BY nd.next_attempt_at NULLS FIRST, nd.created_at, nd.id
        FOR UPDATE SKIP LOCKED
        LIMIT LEAST(GREATEST(p_limit, 0), 100)
      ),
      claimed AS (
        UPDATE public.notification_deliveries nd
        SET
          status = 'processing',
          claim_token = gen_random_uuid(),
          claim_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 1), 3600)),
          updated_at = now()
        FROM candidates
        WHERE nd.id = candidates.id
        RETURNING nd.id AS delivery_id, nd.notification_event_id, nd.claim_token
      )
      SELECT
        claimed.delivery_id,
        ne.shop_id,
        claimed.claim_token
      FROM claimed
      JOIN public.notification_events ne ON ne.id = claimed.notification_event_id;
    $$;

    REVOKE ALL ON FUNCTION public.claim_notification_deliveries(integer, integer) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.claim_notification_deliveries(integer, integer) TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP FUNCTION IF EXISTS public.claim_notification_deliveries(integer, integer);
  `);
  await knex.schema.dropTableIfExists('notification_deliveries');
  await knex.schema.dropTableIfExists('notification_events');
}
