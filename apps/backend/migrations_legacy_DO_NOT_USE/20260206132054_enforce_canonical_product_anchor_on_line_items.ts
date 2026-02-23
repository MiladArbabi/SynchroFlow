import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const row = await knex('canonical_order_line_items')
    .whereNull('canonical_product_anchor_id')
    .count<{ count: string }>('id as count')
    .first();

  const remainingNulls = Number(row?.count ?? 0);

  if (remainingNulls > 0) {
    /**
     * CR-1 SAFETY GUARD
     * ----------------
     * Enforcement is intentionally deferred until:
     * - deterministic backfill completes
     * - ZERO null anchors remain
     */
    return;
  }

  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table
      .integer('canonical_product_anchor_id')
      .notNullable()
      .alter();
  });

  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table
      .foreign('canonical_product_anchor_id')
      .references('canonical_product_id')
      .inTable('canonical_products')
      .onDelete('restrict');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('canonical_order_line_items', (table) => {
    table.dropForeign(['canonical_product_anchor_id']);
    table.integer('canonical_product_anchor_id').nullable().alter();
  });
}
