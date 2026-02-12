// apps/backend/migrations/20260127173518_make_line_item_total_price_nullable.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.decimal('total_price', 10, 2).nullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.decimal('total_price', 10, 2).notNullable().alter();
  });
}
