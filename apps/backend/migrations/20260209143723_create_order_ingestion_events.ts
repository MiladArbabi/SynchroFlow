//apps/backend/migrations/20260209143723_create_order_ingestion_events.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_ingestion_events', table => {
    table.integer('shop_id').notNullable();
    table.text('canonical_order_id').notNullable();
    table.text('module_id').notNullable(); // 'order-nexus'
    table.timestamp('ingested_at', { useTz: true }).notNullable();
    table.text('source').notNullable(); // 'queue' | 'replay'

    table.primary(['shop_id', 'canonical_order_id', 'module_id']);

    table.index(
      ['shop_id', 'ingested_at'],
      'idx_order_ingestion_events_shop_time'
    );
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_ingestion_events');
}
