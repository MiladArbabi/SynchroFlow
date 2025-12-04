//apps/backend/migrations/20251031201625_create_user_sessions_table.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  return knex.schema.createTable('user_sessions', (table) => {
    table.string('sid').primary();
    table.json('sess').notNullable();
    table.timestamp('expire', { useTz: true }).notNullable().index();
  });
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.dropTable('user_sessions');
}