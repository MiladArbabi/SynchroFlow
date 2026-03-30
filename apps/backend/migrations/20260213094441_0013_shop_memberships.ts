// apps/backend/migrations/20260108144712_create_shop_memberships_table.ts
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_memberships', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .integer('user_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');

    table.string('role', 50).notNullable(); // e.g. admin, operator, viewer

    table.timestamps(true, true);

    table.unique(['shop_id', 'user_id']);
    table.index(['user_id']);
    table.index(['shop_id']);
  });

  // --- RLS: Enforce tenant isolation (direct) ---
// shop_id is NOT NULL → authoritative tenant anchor
await knex.raw(`
  ALTER TABLE shop_memberships ENABLE ROW LEVEL SECURITY;
  ALTER TABLE shop_memberships FORCE ROW LEVEL SECURITY;
`);

await knex.raw(`
  DROP POLICY IF EXISTS shop_memberships_tenant_isolation_policy ON shop_memberships;
`);

await knex.raw(`
  CREATE POLICY shop_memberships_tenant_isolation_policy
  ON shop_memberships
  USING (
    shop_id = current_setting('app.current_tenant')::int
  );
`);

/**
 * NOTE:
 * Direct enforcement via shop_id
 * Memberships must never be visible across tenants
 */
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_memberships');
}
