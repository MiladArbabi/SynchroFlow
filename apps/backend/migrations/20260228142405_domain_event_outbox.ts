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
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('domain_event_outbox');
}