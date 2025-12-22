//apps/backend/migrations/20251222122355_create_ft0_state.js
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('ft0_state', table => {
    table.integer('shop_id').primary();
    table.string('status').notNullable(); // 'PENDING' | 'COMPLETED'
    table.timestamp('completed_at').nullable();
    table.jsonb('completion_reason').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ft0_state');
}