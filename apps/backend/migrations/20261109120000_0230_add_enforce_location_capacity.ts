import type { Knex } from 'knex';

/**
 * MIGRATION 0230 — add_enforce_location_capacity (SF-STOW-SAD-PATH-01 S1)
 *
 * Shop-level opt-in for hard Stow capacity enforcement against
 * warehouse_locations.max_capacity. Additive only: NOT NULL DEFAULT false
 * leaves every existing merchant on today's advisory behaviour. No backfill;
 * warehouse_locations.max_capacity is untouched.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table.boolean('enforce_location_capacity').notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('shop_wms_settings', (table) => {
    table.dropColumn('enforce_location_capacity');
  });
}
