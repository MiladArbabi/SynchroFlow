// apps/backend/migrations/20260105110709_extend_refresh_tokens_v1.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refresh_tokens', (table) => {
    // 🔐 Session binding (Auth Contract v1)
    table
      .uuid('session_id')
      .notNullable()
      .comment('Auth session anchor; shared across access token rotations');

    // 🔐 Token versioning (forced logout / revocation)
    table
      .integer('token_version')
      .notNullable()
      .defaultTo(1)
      .comment('Token version for hard revocation');

    // 🏪 Optional shop context
    table
      .integer('shop_id')
      .nullable()
      .comment('Shop context for shop_user sessions');

    table.index(['session_id'], 'refresh_tokens_session_id_idx');
    table.index(['token_version'], 'refresh_tokens_token_version_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refresh_tokens', (table) => {
    table.dropIndex(['session_id'], 'refresh_tokens_session_id_idx');
    table.dropIndex(['token_version'], 'refresh_tokens_token_version_idx');

    table.dropColumn('session_id');
    table.dropColumn('token_version');
    table.dropColumn('shop_id');
  });
}