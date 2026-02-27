import { Knex } from 'knex';

/**
 * SNAPSHOT: order_margin_snapshot
 * --------------------------------
 * Materialized during reconciliation.
 *
 * Derived from:
 * - order_revenue_units_net (net_revenue)
 * - estimated_unit_cost
 *
 * Replace-on-reconcile.
 * Deterministic.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_margin_snapshot', (table) => {
    table.uuid('lasyncro_order_id')
      .primary()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');
    
    /**
     * PROJECTION VERSION (HARD GUARANTEE)
     * ------------------------------------
     * Records the exact aggregate_version used
     * during reconciliation.
     *
     * Enables deterministic replay validation.
     */
    table.integer('aggregate_version')
      .notNullable()
      .comment('Projection version used to compute this snapshot');

    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.decimal('gross_revenue', 14, 2).notNullable();
    table.decimal('estimated_cost', 14, 2).notNullable();
    table.decimal('gross_margin', 14, 2).notNullable();

    table.decimal('margin_pct', 6, 4).notNullable();

    table.timestamp('evaluated_at')
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('order_margin_snapshot', (table) => {
    table.index(['shop_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_margin_snapshot');
}