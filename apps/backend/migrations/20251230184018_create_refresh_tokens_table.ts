//apps/backend/migrations/20251230184018_create_refresh_tokens_table.ts

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('refresh_tokens', (table) => {
    table.increments('id').primary();

    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    // Store ONLY a hash of the refresh token (never the raw token)
    table.string('token_hash', 255).notNullable();

    table.timestamp('expires_at', { useTz: true }).notNullable();

    // Null = active, set = revoked
    table.timestamp('revoked_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // One active token per user/session intent
    table.index(['user_id'], 'refresh_tokens_user_id_idx');
    table.index(['token_hash'], 'refresh_tokens_token_hash_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  // Forward-only discipline: allow safe rollback if needed
  await knex.schema.dropTableIfExists('refresh_tokens');
}
