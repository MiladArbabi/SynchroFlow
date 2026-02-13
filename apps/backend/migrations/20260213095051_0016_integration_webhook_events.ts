import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('integration_webhook_events', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('integration').notNullable(); // e.g. 'shopify'
    table.string('external_event_id').notNullable();
    table.string('event_type').notNullable();

    table.jsonb('payload').notNullable();

    table.timestamp('received_at', { useTz: true })
         .notNullable()
         .defaultTo(knex.fn.now());

    table.unique(
      ['shop_id', 'integration', 'external_event_id'],
      'integration_webhook_events_unique'
    );

    table.index(['shop_id']);
    table.index(['integration']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('integration_webhook_events');
}
