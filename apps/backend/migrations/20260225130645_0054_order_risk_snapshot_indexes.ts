import { Knex } from 'knex';

/**
 * Performance index for risk dashboards.
 * Supports:
 *   WHERE shop_id = ? AND is_at_risk = true
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_risk_snapshot', (table) => {
    table.index(['shop_id', 'is_at_risk'], 'ors_shop_risk_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('order_risk_snapshot', (table) => {
    table.dropIndex(['shop_id', 'is_at_risk'], 'ors_shop_risk_idx');
  });
}