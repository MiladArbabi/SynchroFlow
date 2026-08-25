import type { Knex } from 'knex';

/**
 * MON-ALLOW-04 — durable billing delivery on the single domain-event outbox
 * --------------------------------------------------------------------------
 * SynchroFlow owns exactly one outbox: domain_event_outbox.
 *
 * Normal domain events retain the existing publish-marker behavior.
 * billing/overage events are excluded from that path and instead:
 *
 * 1. atomically claimed with FOR UPDATE SKIP LOCKED;
 * 2. attempt state is committed BEFORE the external provider call;
 * 3. success marks published_at;
 * 4. failure retains the row for retry with last_error/retry_count.
 *
 * Shopify events may retry indefinitely because Shopify App Event
 * idempotency keys are permanent.
 *
 * Stripe retries are automatically suspended 24h after the first attempt:
 * Stripe Meter Event identifier deduplication is not permanent, so retrying
 * later could create a duplicate charge. The unpublished row remains visible
 * for operator reconciliation rather than being silently discarded.
 */
export async function up(knex: Knex): Promise<void> {
  const hasFirstAttemptAt = await knex.schema.hasColumn(
    'domain_event_outbox',
    'first_attempt_at'
  );
  const hasLastAttemptAt = await knex.schema.hasColumn(
    'domain_event_outbox',
    'last_attempt_at'
  );
  const hasProcessingAt = await knex.schema.hasColumn(
    'domain_event_outbox',
    'processing_at'
  );

  await knex.schema.alterTable('domain_event_outbox', (table) => {
    if (!hasFirstAttemptAt) {
      table.timestamp('first_attempt_at', { useTz: true }).nullable();
    }

    if (!hasLastAttemptAt) {
      table.timestamp('last_attempt_at', { useTz: true }).nullable();
    }

    if (!hasProcessingAt) {
      table.timestamp('processing_at', { useTz: true }).nullable();
    }
  });

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_domain_event_outbox_processing_at
    ON public.domain_event_outbox (processing_at)
    WHERE published_at IS NULL;
  `);

  /**
   * Preserve the existing non-billing behavior, but NEVER mark
   * billing/overage published here.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.dispatch_domain_event_outbox_batch(
      p_limit integer DEFAULT 20
    )
    RETURNS TABLE (outbox_id bigint, domain_event_id bigint)
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      WITH candidates AS (
        SELECT outbox.id
        FROM public.domain_event_outbox AS outbox
        JOIN public.domain_events AS event
          ON event.id = outbox.domain_event_id
        WHERE outbox.published_at IS NULL
          AND event.event_type <> 'billing/overage'
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
    $$;

    REVOKE ALL
    ON FUNCTION public.dispatch_domain_event_outbox_batch(integer)
    FROM PUBLIC;

    GRANT EXECUTE
    ON FUNCTION public.dispatch_domain_event_outbox_batch(integer)
    TO sf_app;
  `);

  /**
   * Claim exactly one billing event.
   *
   * processing_at provides crash recovery:
   * an abandoned claim becomes eligible again after two minutes.
   *
   * first_attempt_at is persisted by this claim BEFORE any network call.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.claim_billing_overage_outbox()
    RETURNS TABLE (
      outbox_id bigint,
      domain_event_id bigint,
      shop_id integer,
      event_payload jsonb,
      event_time timestamptz,
      retry_count integer,
      first_attempt_at timestamptz
    )
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      WITH candidate AS (
        SELECT
          outbox.id AS outbox_id,
          event.id AS domain_event_id,
          event.shop_id,
          event.event_payload,
          event.event_time
        FROM public.domain_event_outbox AS outbox
        JOIN public.domain_events AS event
          ON event.id = outbox.domain_event_id
        WHERE outbox.published_at IS NULL
          AND event.event_type = 'billing/overage'

          -- Active claim, unless the previous worker died.
          AND (
            outbox.processing_at IS NULL
            OR outbox.processing_at <
               pg_catalog.now() - interval '2 minutes'
          )

          -- Exponential retry: 5s, 10s, 20s ... capped at 5 minutes.
          AND (
            outbox.last_attempt_at IS NULL
            OR outbox.last_attempt_at <=
               pg_catalog.now() -
               pg_catalog.make_interval(
                 secs => LEAST(
                   300,
                   5 * pg_catalog.power(
                     2,
                     LEAST(outbox.retry_count, 6)
                   )::integer
                 )
               )
          )

          -- Stripe automatic retry stops 24h after FIRST attempt.
          -- A never-attempted Stripe event remains eligible regardless
          -- of age so a worker outage cannot silently lose first delivery.
          AND (
            COALESCE(event.event_payload->>'billing_provider', '') <> 'stripe'
            OR outbox.first_attempt_at IS NULL
            OR outbox.first_attempt_at >=
               pg_catalog.now() - interval '24 hours'
          )

        ORDER BY outbox.id
        LIMIT 1
        FOR UPDATE OF outbox SKIP LOCKED
      )
      UPDATE public.domain_event_outbox AS outbox
      SET processing_at = pg_catalog.now(),
          first_attempt_at =
            COALESCE(outbox.first_attempt_at, pg_catalog.now()),
          last_attempt_at = pg_catalog.now()
      FROM candidate
      WHERE outbox.id = candidate.outbox_id
      RETURNING
        outbox.id,
        candidate.domain_event_id,
        candidate.shop_id,
        candidate.event_payload,
        candidate.event_time,
        outbox.retry_count,
        outbox.first_attempt_at
    $$;

    REVOKE ALL
    ON FUNCTION public.claim_billing_overage_outbox()
    FROM PUBLIC;

    GRANT EXECUTE
    ON FUNCTION public.claim_billing_overage_outbox()
    TO sf_app;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.mark_billing_overage_outbox_published(
      p_outbox_id bigint
    )
    RETURNS void
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      UPDATE public.domain_event_outbox
      SET published_at = pg_catalog.now(),
          processing_at = NULL,
          last_error = NULL
      WHERE id = p_outbox_id
        AND published_at IS NULL
    $$;

    REVOKE ALL
    ON FUNCTION public.mark_billing_overage_outbox_published(bigint)
    FROM PUBLIC;

    GRANT EXECUTE
    ON FUNCTION public.mark_billing_overage_outbox_published(bigint)
    TO sf_app;
  `);

  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.record_billing_overage_outbox_failure(
      p_outbox_id bigint,
      p_error text
    )
    RETURNS void
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      UPDATE public.domain_event_outbox
      SET processing_at = NULL,
          retry_count = retry_count + 1,
          last_error = LEFT(COALESCE(p_error, 'unknown billing delivery error'), 2000)
      WHERE id = p_outbox_id
        AND published_at IS NULL
    $$;

    REVOKE ALL
    ON FUNCTION public.record_billing_overage_outbox_failure(bigint, text)
    FROM PUBLIC;

    GRANT EXECUTE
    ON FUNCTION public.record_billing_overage_outbox_failure(bigint, text)
    TO sf_app;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP FUNCTION IF EXISTS
      public.record_billing_overage_outbox_failure(bigint, text);

    DROP FUNCTION IF EXISTS
      public.mark_billing_overage_outbox_published(bigint);

    DROP FUNCTION IF EXISTS
      public.claim_billing_overage_outbox();
  `);

  // Restore the pre-MON-ALLOW-04 dispatcher behavior.
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.dispatch_domain_event_outbox_batch(
      p_limit integer DEFAULT 20
    )
    RETURNS TABLE (outbox_id bigint, domain_event_id bigint)
    LANGUAGE sql
    VOLATILE
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $$
      WITH candidates AS (
        SELECT outbox.id
        FROM public.domain_event_outbox AS outbox
        WHERE outbox.published_at IS NULL
        ORDER BY outbox.id
        LIMIT LEAST(GREATEST(p_limit, 1), 100)
        FOR UPDATE SKIP LOCKED
      )
      UPDATE public.domain_event_outbox AS outbox
      SET published_at = pg_catalog.now(),
          last_error = NULL
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox.domain_event_id
    $$;

    REVOKE ALL
    ON FUNCTION public.dispatch_domain_event_outbox_batch(integer)
    FROM PUBLIC;

    GRANT EXECUTE
    ON FUNCTION public.dispatch_domain_event_outbox_batch(integer)
    TO sf_app;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS public.idx_domain_event_outbox_processing_at;
  `);

  await knex.schema.alterTable('domain_event_outbox', (table) => {
    table.dropColumn('processing_at');
    table.dropColumn('last_attempt_at');
    table.dropColumn('first_attempt_at');
  });
}
