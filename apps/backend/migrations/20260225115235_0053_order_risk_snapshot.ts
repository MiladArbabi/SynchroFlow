import { Knex } from 'knex';

/**
 * SNAPSHOT: order_risk_snapshot
 * --------------------------------
 * Materialized during reconciliation.
 *
 * Guarantees:
 * - One row per order
 * - Replace-on-reconcile
 * - Derived from canonical + obligation state
 * - No runtime mutation
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_risk_snapshot', (table) => {
    table.uuid('lasyncro_order_id')
      .primary()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.boolean('is_inventory_blocked').notNullable();
    table.boolean('is_customer_blocked').notNullable();
    table.boolean('is_operational_blocked').notNullable();

    table.boolean('is_at_risk').notNullable();

    table.timestamp('evaluated_at')
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('order_risk_snapshot', (table) => {
    table.index(['shop_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_risk_snapshot');
}