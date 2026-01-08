//apps/backend/migrations/20260108151258_create_shop_memberships_table.ts

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('shop_memberships');
  if (exists) return;

  await knex.schema.createTable('shop_memberships', table => {
    table.increments('id').primary();

    // 🔒 Identity
    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .integer('user_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    // 🎭 Authorization
    table
      .string('role', 32)
      .notNullable()
      .comment('owner | admin | operator | viewer');

    // 🧠 Lifecycle
    table
      .timestamp('joined_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .timestamp('revoked_at', { useTz: true })
      .nullable()
      .comment('Soft removal from shop');

    // 🔐 Invariants
    table.unique(['shop_id', 'user_id'], {
      indexName: 'uniq_shop_memberships_shop_user',
    });

    table.index(['user_id'], 'idx_shop_memberships_user');
    table.index(['shop_id'], 'idx_shop_memberships_shop');
    table.index(['role'], 'idx_shop_memberships_role');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_memberships');
}
