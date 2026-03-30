import { Knex } from 'knex';

/**
 * ARCHITECTURE NOTE — SINGLE OUTBOX SYSTEM
 * -----------------------------------------
 * SynchroFlow uses exactly ONE outbox table:
 *   - domain_event_outbox (event-core boundary)
 *
 * No secondary outbox tables are permitted.
 * If you believe another outbox is required,
 * STOP and re-evaluate architectural ownership.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('domain_event_outbox', (table) => {
    table.bigIncrements('id').primary();

    table
      .bigInteger('domain_event_id')
      .notNullable()
      .references('id')
      .inTable('domain_events')
      .onDelete('CASCADE');

    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('published_at').nullable();

    table.integer('retry_count').defaultTo(0).notNullable();
    table.text('last_error').nullable();

    table.index(['published_at']);
    table.index(['domain_event_id']);

    /**
     * EXACTLY-ONCE ENQUEUE GUARANTEE
     * --------------------------------
     * Each domain_event_id must appear exactly once.
     *
     * Prevents duplicate publish attempts caused by
     * application bugs or transaction retries.
     */
    table.unique(['domain_event_id'], 'domain_event_outbox_domain_event_unique');
  });



  /**
   * DOMAIN EVENT → OUTBOX ENFORCEMENT
   * ----------------------------------
   * Trigger defined here to ensure domain_event_outbox
   * exists before dependency is created.
   *
   * Guarantees exactly one outbox row per domain_event.
   * Idempotent via ON CONFLICT.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION auto_create_domain_event_outbox()
    RETURNS trigger AS $$
    BEGIN
      -- TRACE: emit structural execution proof
      RAISE NOTICE 'OUTBOX_TRIGGER txid=%, pid=%, domain_event_id=%',
        txid_current(),
        pg_backend_pid(),
        NEW.id;

      INSERT INTO domain_event_outbox (domain_event_id)
      VALUES (NEW.id)
      ON CONFLICT (domain_event_id) DO NOTHING;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER domain_event_auto_outbox
    AFTER INSERT ON domain_events
    FOR EACH ROW
    EXECUTE FUNCTION auto_create_domain_event_outbox();
  `);

 // --- RLS: Enforce tenant isolation (via domain_events) ---
  // No direct shop_id → must enforce via domain_events relation.
  // CRITICAL: outbox is cross-boundary delivery surface.
  await knex.raw(`
    ALTER TABLE domain_event_outbox ENABLE ROW LEVEL SECURITY;
    ALTER TABLE domain_event_outbox FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS domain_event_outbox_tenant_isolation_policy ON domain_event_outbox;
  `);

  await knex.raw(`
    CREATE POLICY domain_event_outbox_tenant_isolation_policy
    ON domain_event_outbox
    USING (
      domain_event_id IN (
        SELECT id
        FROM domain_events
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Drop trigger first (if exists)
  await knex.raw(`
    DROP TRIGGER IF EXISTS domain_event_auto_outbox
    ON domain_events;
  `);

  // Drop function explicitly (avoid orphaned functions)
  await knex.raw(`
    DROP FUNCTION IF EXISTS auto_create_domain_event_outbox();
  `);

  // Then drop table
  await knex.schema.dropTableIfExists('domain_event_outbox');
}