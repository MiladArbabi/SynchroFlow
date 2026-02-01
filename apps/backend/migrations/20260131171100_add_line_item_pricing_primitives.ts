// apps/backend/migrations/20260131171100_add_line_item_pricing_primitives.ts
import type { Knex } from "knex";

export async function up(knex: Knex) {
  await knex.schema.alterTable('canonical_order_line_items', (t) => {
    t.decimal('line_total', 14, 4)
      .comment('Platform-reported line total. Optional but preferred.')
      .nullable();

    t.text('price_source')
      .defaultTo('platform_reported')
      .comment('platform_reported | manual');
  });
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('canonical_order_line_items', (t) => {
    t.dropColumn('line_total');
    t.dropColumn('price_source');
  });
}
