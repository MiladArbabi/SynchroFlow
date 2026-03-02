import { Knex } from 'knex';

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
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('domain_event_outbox');
}