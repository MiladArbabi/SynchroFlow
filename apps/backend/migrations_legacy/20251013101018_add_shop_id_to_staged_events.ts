// apps/backend/migrations/20251013101018_add_shop_id_to_staged_events.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('staged_events', (table) => {
    table.integer('shop_id').unsigned().notNullable().index();
    table.foreign('shop_id').references('id').inTable('shops').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('staged_events', (table) => {
    table.dropForeign('shop_id');
    table.dropColumn('shop_id');
  });
}