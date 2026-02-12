import type { Knex } from "knex";


export async function up(knex: Knex) {
  await knex.schema.alterTable('canonical_order_line_items', (t) => {
    t.string('canonical_variant_code')
      .comment('LaSyncro-owned variant identifier (CVC). Stable, printable, scannable.');
  });
}

export async function down(knex: Knex) {
  await knex.schema.alterTable('canonical_order_line_items', (t) => {
    t.dropColumn('canonical_variant_code');
  });
}