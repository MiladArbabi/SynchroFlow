import type { Knex } from 'knex';

export async function up(knex: Knex) {
  await knex.raw(`
    UPDATE canonical_order_line_items
    SET
      unit_price = CASE
        WHEN unit_price IS NULL
         AND total_price IS NOT NULL
         AND quantity > 0
        THEN total_price / quantity
        ELSE unit_price
      END,
      line_total = COALESCE(line_total, total_price),
      price_source = COALESCE(price_source, 'platform_reported')
  `);
}

export async function down(knex: Knex) {
  // irreversible on purpose (historical truth repair)
}
