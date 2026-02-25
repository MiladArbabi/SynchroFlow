import { Knex } from 'knex';

/**
 * EVENT LOG: order_constraint_events
 * -----------------------------------
 * Append-only constraint lifecycle events.
 *
 * Derived from obligation evaluation.
 *
 * Supports:
 * - Root cause grouping
 * - Constraint duration analysis
 * - Risk trend modeling
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_constraint_events', (table) => {
    table.uuid('constraint_event_id')
      .primary();

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.enu('constraint_type', [
      'inventory',
      'customer',
      'operational'
    ]).notNullable();

    table.timestamp('started_at').notNullable();

    table.timestamp('resolved_at').nullable();

    table.boolean('is_active').notNullable();

    table.timestamp('created_at')
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('order_constraint_events', (table) => {
    table.index(['shop_id', 'constraint_type'], 'oce_shop_type_idx');
    table.index(['lasyncro_order_id', 'is_active'], 'oce_order_active_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_constraint_events');
}