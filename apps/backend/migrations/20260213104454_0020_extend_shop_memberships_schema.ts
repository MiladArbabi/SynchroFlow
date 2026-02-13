// apps/backend/migrations/20260213104454_0020_extend_shop_memberships_schema.ts

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_memberships', (table) => {
    table
      .timestamp('revoked_at', { useTz: true })
      .nullable()
      .after('updated_at');

    table.index(['revoked_at'], 'shop_memberships_revoked_at_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_memberships', (table) => {
    table.dropIndex(['revoked_at'], 'shop_memberships_revoked_at_idx');
    table.dropColumn('revoked_at');
  });
}