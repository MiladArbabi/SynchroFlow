//apps/backend/migrations/20251223103210_add_unique_canonical_order_id.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_orders', (table) => {
    table.unique(['canonical_order_id'], 'canonical_orders_canonical_order_id_unique');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_orders', (table) => {
    table.dropUnique(['canonical_order_id'], 'canonical_orders_canonical_order_id_unique');
  });
}
