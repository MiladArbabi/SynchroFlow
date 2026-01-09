//apps/backend/migrations/20260109111911_add_revoked_at_to_shop_memberships.ts 
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_memberships', (table) => {
    table.timestamp('revoked_at').nullable().index();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_memberships', (table) => {
    table.dropColumn('revoked_at');
  });
}
