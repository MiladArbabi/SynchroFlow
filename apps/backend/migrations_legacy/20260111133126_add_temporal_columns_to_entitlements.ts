//apps/backend/migrations/20260111133126_add_temporal_columns_to_entitlements.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_module_entitlements', (table) => {
    table.timestamp('valid_from').notNullable().defaultTo(knex.fn.now());
    table.timestamp('valid_until').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_module_entitlements', (table) => {
    table.dropColumn('valid_from');
    table.dropColumn('valid_until');
  });
}
