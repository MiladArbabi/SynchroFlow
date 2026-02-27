import type { Knex } from 'knex';

/**
 * DOMAIN EVENTS (IMMUTABLE CANONICAL LOG)
 * ---------------------------------------
 * This table replaces staged_events.
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
     * Versioning for schema evolution.
     * Enables deterministic deserialization.
     */
    table.integer('event_version')
      .notNullable()
      .defaultTo(1);

    /**
     * Per-shop monotonic ordering key.
     * Required for deterministic rebuild.
     */
    table.bigInteger('event_sequence')
      .notNullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * Enforce strict per-shop ordering.
     */
    table.unique(
      ['shop_id', 'event_sequence'],
      'domain_events_shop_sequence_unique'
    );

    table.index(['shop_id']);
    table.index(['event_type']);
    table.index(['event_time']);
  });

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