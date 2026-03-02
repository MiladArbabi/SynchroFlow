import type { Knex } from 'knex';

/**
 * DOMAIN EVENTS (IMMUTABLE CANONICAL LOG)
 * ---------------------------------------
 *
 * STRICT RULES:
 * - Append-only
 * - No processing state
 * - No retry tracking
 * - No mutation flags
 * - Sufficient for deterministic full rebuild
 *
 * Projection state must live elsewhere.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('domain_events', (table) => {
    table.bigIncrements('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    /**
     * Domain-level classification
     * e.g. 'orders.create'
     */
    table.string('event_type').notNullable();

    /**
     * Immutable business payload
     */
    table.jsonb('event_payload').notNullable();

    /**
     * Canonical event-time anchor.
     * Deterministic replay depends on this.
     */
    table.timestamp('event_time', { useTz: true })
      .notNullable();

    /**
     * NOTE:
     * event_sequence removed.
     *
     * Global deterministic ordering is guaranteed
     * by the primary key (id).
     *
     * Per-shop sequence was unused in projection,
     * race-prone under concurrency,
     * and provided no additional ordering guarantee.
     */

    /**
     * Versioning for schema evolution.
     * Enables deterministic deserialization.
     */
    table.integer('event_version')
      .notNullable()
      .defaultTo(1);
    
    /**
     * External webhook identity.
     * Nullable because internal domain events
     * (lifecycle, system events) have no external source.
     */
    table.string('external_event_id').nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['event_type']);
    table.index(['event_time']);

    /**
     * Ingestion idempotency constraint.
     * Applies only when external_event_id IS NOT NULL.
     *
     * Allows internal domain events to omit external identity.
     */
  });

  await knex.raw(`
    CREATE UNIQUE INDEX domain_events_shop_external_event_unique
    ON domain_events (shop_id, external_event_id)
    WHERE external_event_id IS NOT NULL;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX domain_events_shop_first_insight_unique
    ON domain_events (shop_id)
    WHERE event_type = 'lifecycle/first_insight_delivered';
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX domain_events_shop_ft0_unique
    ON domain_events (shop_id)
    WHERE event_type = 'lifecycle/ft0_completed';
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX domain_events_shop_ft2_unique
    ON domain_events (shop_id)
    WHERE event_type = 'lifecycle/ft2_confirmed';
  `);

  /**
   * HARD IMMUTABILITY GUARD
   * -----------------------
   * Prevent UPDATE and DELETE at DB level.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION prevent_domain_event_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'domain_events is immutable';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER domain_events_no_update
    BEFORE UPDATE ON domain_events
    FOR EACH ROW EXECUTE FUNCTION prevent_domain_event_mutation();
  `);

  await knex.raw(`
    CREATE TRIGGER domain_events_no_delete
    BEFORE DELETE ON domain_events
    FOR EACH ROW EXECUTE FUNCTION prevent_domain_event_mutation();
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('domain_events');
}