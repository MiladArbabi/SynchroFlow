import { Knex } from 'knex';

/**
 * FIX: Restore PRIMARY KEY for orders_operational_control_snapshot
 *
 * Root issue:
 * - Table has UNIQUE constraint instead of PRIMARY KEY
 * - Breaks SchemaGuard invariant
 *
 * Strategy:
 * - Drop incorrect UNIQUE constraint
 * - Add correct composite PRIMARY KEY
 *
 * NOTE:
 * Safe because UNIQUE already guarantees no duplicates
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders_operational_control_snapshot', (table) => {
    table.dropUnique(['shop_id', 'snapshot_date'], 'orders_operational_control_snapshot_unique');
  });

  await knex.schema.alterTable('orders_operational_control_snapshot', (table) => {
    table.primary(['shop_id', 'snapshot_date']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('orders_operational_control_snapshot', (table) => {
    table.dropPrimary();
  });

  await knex.schema.alterTable('orders_operational_control_snapshot', (table) => {
    table.unique(['shop_id', 'snapshot_date'], 'orders_operational_control_snapshot_unique');
  });
}