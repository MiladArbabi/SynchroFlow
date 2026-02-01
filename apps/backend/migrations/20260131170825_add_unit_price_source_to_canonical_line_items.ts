import type { Knex } from "knex";


export async function up(knex: Knex) {
  await knex.schema.alterTable('canonical_order_line_items', (t) => {
    t.text('unit_price_source')
      .comment('platform_reported | backfilled | manual');
  });
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('canonical_order_line_items', (t) => {
    t.dropColumn('unit_price_source');
  });
}
