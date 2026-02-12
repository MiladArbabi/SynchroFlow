// apps/backend/migrations/20260111163240_create_integration_webhook_events.ts.ts
//
// integration_webhook_events
// --------------------------
// Transport-level webhook ledger.
//
// HARD RULES:
// - One row per external webhook event
// - Inserted BEFORE any domain mutation
// - Never deleted
// - Idempotent by (integration, external_event_id)
// - Payload preserved verbatim for replay/debug
//
// This table is NOT domain logic.
// It is infrastructure & observability.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('integration_webhook_events', (table) => {
    table.bigIncrements('id').primary();

    // Source
    table.string('integration', 50).notNullable();         // e.g. 'stripe'
    table.string('external_event_id', 255).notNullable();  // e.g. evt_123
    table.string('event_type', 255).notNullable();         // e.g. invoice.paid

    // Payload
    table.jsonb('payload').notNullable();

    // Verification
    table.boolean('verified').notNullable().defaultTo(false);
    table.text('verification_error');

    // Processing
    table.string('processing_status', 50)
      .notNullable()
      .defaultTo('received'); // received | duplicate | ignored | processed | failed
    table.text('processing_error');

    // Resolution
    table.integer('shop_id').nullable();                   // nullable by design
    table.string('idempotency_key', 255).notNullable();

    // Timing
    table.timestamp('received_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Idempotency guarantee
    table.unique(
      ['integration', 'external_event_id'],
      'uq_integration_webhook_events_external'
    );
  });

  // Indexes (explicit, minimal)
  await knex.schema.raw(`
    CREATE INDEX integration_webhook_events_integration_idx
      ON integration_webhook_events (integration);
  `);

  await knex.schema.raw(`
    CREATE INDEX integration_webhook_events_shop_id_idx
      ON integration_webhook_events (shop_id);
  `);

  await knex.schema.raw(`
    CREATE INDEX integration_webhook_events_status_idx
      ON integration_webhook_events (processing_status);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('integration_webhook_events');
}