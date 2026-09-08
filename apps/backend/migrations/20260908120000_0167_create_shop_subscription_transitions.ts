import type { Knex } from 'knex';

/**
 * MIGRATION 0167 — create_shop_subscription_transitions
 * ----------------------------------------------------------------------------
 * BILL-ENTITLEMENT-01 / P0-B2 — durable commercial subscription transition
 * provenance.
 *
 * shop_subscriptions holds only CURRENT entitlement-authoritative state
 * (tier, status, billing_provider). Nine separate runtime writers changed that
 * state directly — Stripe webhooks, Shopify reconciliation, install/OAuth,
 * uninstall grace, trial expiry — leaving no record of what changed, who
 * changed it, or why. A merchant's tier silently moving from growth to starter
 * was unattributable after the fact.
 *
 * This table is the append-only ledger for those transitions. It records the
 * full authoritative triple BEFORE and AFTER every change, plus mandatory
 * provenance (source / reason / actor_type). Creation of a subscription is
 * recorded with NULL from_* values.
 *
 * A row exists only when authoritative state ACTUALLY changed. Accompanying
 * non-authoritative columns (billing_interval, period bounds, seats, trial
 * window, provider handles) are still written to shop_subscriptions by the
 * canonical service without producing a ledger row of their own — they are
 * not entitlement decisions.
 *
 * Deliberately NOT reusing domain_events: that table is the ingestion/projection
 * event spine keyed to external source events and consumed by the outbox
 * dispatcher. A commercial transition is an internal authoritative state
 * change, has no external delivery contract, and must survive independently of
 * projection replay.
 *
 * Carries the standard forced tenant RLS policy (it holds shop_id), matching
 * migration 0164 (order_intake_exceptions). Table privileges come from the
 * schema-wide default privileges established in 0105.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_subscription_transitions', (table) => {
    table.bigIncrements('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    /**
     * Authoritative triple, BEFORE and AFTER.
     *
     * from_* are NULL for a creation transition (the shop had no
     * shop_subscriptions row). to_* are always the complete resulting state,
     * including dimensions the caller did not change, so a single row answers
     * "what was this shop entitled to at this moment" without replaying the
     * whole chain.
     *
     * Values are recorded verbatim as the caller applied them. Downgrade
     * status semantics deliberately differ per source (Stripe cancel and
     * Shopify force-downgrade record 'canceled'; trial expiry records
     * 'active') and this ledger does NOT normalize them.
     */
    table.string('from_tier', 32).nullable();
    table.string('to_tier', 32).notNullable();
    table.string('from_status', 32).nullable();
    table.string('to_status', 32).notNullable();
    table.string('from_billing_provider', 10).nullable();
    table.string('to_billing_provider', 10).notNullable();

    /**
     * Provenance. All three are mandatory — an unattributable entitlement
     * change is exactly the condition this table exists to make impossible.
     *   source     — the writer/subsystem (e.g. 'stripe_webhook')
     *   reason     — why it happened (e.g. 'invoice.payment_failed')
     *   actor_type — 'system' | 'stripe' | 'shopify' | 'user' | 'worker'
     */
    table.text('source').notNullable();
    table.text('reason').notNullable();
    table.string('actor_type', 32).notNullable();

    // Nullable: many transitions have no human/identified actor.
    table.text('actor_id').nullable();

    // Nullable: only provider-driven transitions carry an upstream event id.
    table.text('external_event_id').nullable();

    /**
     * Nullable. When supplied, replaying the same delivery must not apply the
     * transition twice — enforced by the partial unique index below, which is
     * scoped to the shop so two tenants can never collide on a provider id.
     */
    table.text('idempotency_key').nullable();

    // Diagnostic context only. Never an entitlement input.
    table.jsonb('metadata').nullable();

    // When the transition happened (caller-supplied for provider events).
    table.timestamp('occurred_at', { useTz: true }).notNullable();

    // When this row was durably written.
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Per-shop history reads are the primary access path.
    table.index(['shop_id'], 'shop_subscription_transitions_shop_idx');
    table.index(
      ['shop_id', 'occurred_at'],
      'shop_subscription_transitions_shop_occurred_idx'
    );
  });

  /**
   * Idempotency: unique per (shop_id, idempotency_key) but ONLY for non-null
   * keys. A partial index is required — a plain unique index would treat every
   * NULL as distinct in PostgreSQL, which is the behaviour we want, but the
   * partial form states the intent explicitly and keeps the index small.
   */
  await knex.raw(`
    CREATE UNIQUE INDEX shop_subscription_transitions_idempotency_uidx
      ON shop_subscription_transitions (shop_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  `);

  await knex.raw(`
    ALTER TABLE shop_subscription_transitions
      ENABLE ROW LEVEL SECURITY;

    ALTER TABLE shop_subscription_transitions
      FORCE ROW LEVEL SECURITY;

    CREATE POLICY shop_subscription_transitions_tenant_isolation_policy
      ON shop_subscription_transitions
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

  /**
   * HARD APPEND-ONLY GUARD
   * ----------------------
   * Commercial history that can be rewritten is not provenance. UPDATE and
   * DELETE are rejected at the database level, for every role, with no
   * session-setting escape hatch (unlike 0065's snapshot guard, which needs
   * one for rebuilds — this ledger is never rebuilt). INSERT stays permitted.
   *
   * Mirrors the domain_events immutability trigger pattern (0018).
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_shop_subscription_transition_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION
        '[IMMUTABILITY_VIOLATION] shop_subscription_transitions is append-only. % is not allowed.',
        TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER shop_subscription_transitions_no_update
    BEFORE UPDATE ON shop_subscription_transitions
    FOR EACH ROW EXECUTE FUNCTION prevent_shop_subscription_transition_mutation();
  `);

  await knex.raw(`
    CREATE TRIGGER shop_subscription_transitions_no_delete
    BEFORE DELETE ON shop_subscription_transitions
    FOR EACH ROW EXECUTE FUNCTION prevent_shop_subscription_transition_mutation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP TRIGGER IF EXISTS shop_subscription_transitions_no_delete
      ON shop_subscription_transitions;
    DROP TRIGGER IF EXISTS shop_subscription_transitions_no_update
      ON shop_subscription_transitions;
  `);
  await knex.raw(
    `DROP FUNCTION IF EXISTS prevent_shop_subscription_transition_mutation();`
  );
  await knex.schema.dropTableIfExists('shop_subscription_transitions');
}
