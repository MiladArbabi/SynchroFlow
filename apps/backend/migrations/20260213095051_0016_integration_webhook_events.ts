import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'webhook_processing_status_enum'
      ) THEN
        CREATE TYPE webhook_processing_status_enum AS ENUM (
          'received',
          'ignored',
          'processed',
          'failed'
        );
      END IF;
    END
    $$;
  `);

  await knex.schema.createTable('integration_webhook_events', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .nullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('integration').notNullable();
    table.string('external_event_id').notNullable();
    table.string('event_type').notNullable();

    table.jsonb('payload').notNullable();

    // ✅ Required by WebhookLedgerService
    table.string('idempotency_key').notNullable();
    table
      .specificType('processing_status', 'webhook_processing_status_enum')
      .notNullable()
      .defaultTo('received');

    table.boolean('verified').notNullable().defaultTo(false);
    table.text('processing_error').nullable();

    table.timestamp('received_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

    // Idempotency constraint (stronger than old one)
    table.unique(
      ['integration', 'external_event_id'],
      'integration_webhook_events_unique_event'
    );

    table.unique(
      ['integration', 'idempotency_key'],
      'integration_webhook_events_unique_idempotency'
    );

    table.index(['shop_id']);
    table.index(['integration']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('integration_webhook_events');

  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'webhook_processing_status_enum'
      ) THEN
        DROP TYPE webhook_processing_status_enum;
      END IF;
    END
    $$;
  `);
}
