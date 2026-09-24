import type { Knex } from 'knex';

/**
 * Shop-wide opening inventory reconciliation cohort anchor.
 *
 * The timestamp means the initial physical-bin snapshot has been created.
 * The snapshot membership itself remains represented by the immutable set of
 * purpose='opening_inventory' recount tasks.
 *
 * Completion / acceptance / Shopify cutover timestamps deliberately belong to
 * later slices when those actions actually exist.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table
      .timestamp('opening_inventory_reconciliation_started_at', {
        useTz: true,
      })
      .nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table.dropColumn('opening_inventory_reconciliation_started_at');
  });
}
