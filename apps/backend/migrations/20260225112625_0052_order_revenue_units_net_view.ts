import { Knex } from 'knex';

/**
 * VIEW: order_revenue_units_net
 * --------------------------------
 * Immutable revenue units with derived refund aggregation.
 *
 * This view:
 * - Preserves insert-only revenue units
 * - Derives refund quantities from refund_execution_line_items
 * - Centralizes net revenue logic
 * - Eliminates resolver-level subqueries
 */

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE VIEW order_revenue_units_net AS
    SELECT
      ru.*,
      COALESCE(SUM(rel.refunded_quantity), 0) AS refunded_quantity,
      (ru.quantity - COALESCE(SUM(rel.refunded_quantity), 0)) AS net_quantity,
      (ru.quantity - COALESCE(SUM(rel.refunded_quantity), 0)) * ru.unit_price AS net_revenue
    FROM order_revenue_units ru
    LEFT JOIN refund_execution_line_items rel
      ON rel.lasyncro_revenue_unit_id = ru.lasyncro_revenue_unit_id
    GROUP BY ru.lasyncro_revenue_unit_id;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP VIEW IF EXISTS order_revenue_units_net;`);
}