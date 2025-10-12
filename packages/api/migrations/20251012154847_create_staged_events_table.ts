// packages/api/migrations/20251012154847_create_staged_events_table.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('staged_events', (table) => {
    table.increments('id').primary();
    table.string('source_platform').notNullable().index();
    table.string('event_type').notNullable();
    table.jsonb('raw_payload').notNullable();
    table
      .enum('status', ['received', 'processing', 'completed', 'failed'], {
        useNative: true,
        enumName: 'event_status_type',
      })
      .notNullable()
      .defaultTo('received');
    table.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable('staged_events');
  await knex.raw('DROP TYPE IF EXISTS event_status_type');
}