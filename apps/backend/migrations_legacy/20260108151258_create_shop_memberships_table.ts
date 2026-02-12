// apps/backend/migrations/20260108151258_create_shop_memberships_table.ts

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
    table.string('role', 32).notNullable();

    // 🧠 Lifecycle
    table
      .timestamp('joined_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table
      .timestamp('revoked_at', { useTz: true })
      .nullable()
      .comment('Soft removal from shop');

    table.index(['user_id'], 'idx_shop_memberships_user');
    table.index(['shop_id'], 'idx_shop_memberships_shop');
    table.index(['role'], 'idx_shop_memberships_role');
  });

  // 🔐 Role constraint (Postgres CHECK)
  await knex.raw(`
    ALTER TABLE shop_memberships
    ADD CONSTRAINT chk_shop_memberships_role_valid
    CHECK (role IN ('owner', 'admin', 'operator', 'viewer'))
  `);

  // 🔐 One ACTIVE membership per shop/user
  await knex.raw(`
    CREATE UNIQUE INDEX uniq_shop_memberships_active
    ON shop_memberships (shop_id, user_id)
    WHERE revoked_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS uniq_shop_memberships_active`);
  await knex.schema.dropTableIfExists('shop_memberships');
}
