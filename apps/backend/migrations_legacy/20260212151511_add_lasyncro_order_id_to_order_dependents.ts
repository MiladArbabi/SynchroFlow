import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  const tables = [
    'canonical_order_line_items',
    'canonical_returns',
    'customer_blocking_events',
    'operational_blocking_events',
    'order_fulfillment_status',
    'order_revenue_units',
    'refund_execution_line_items',
    'refund_executions',
  ];

  for (const tableName of tables) {
    await knex.schema.alterTable(tableName, (table) => {
      table.uuid('lasyncro_order_id').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'canonical_order_line_items',
    'canonical_returns',
    'customer_blocking_events',
    'operational_blocking_events',
    'order_fulfillment_status',
    'order_revenue_units',
    'refund_execution_line_items',
    'refund_executions',
  ];

  for (const tableName of tables) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('lasyncro_order_id');
    });
  }
}