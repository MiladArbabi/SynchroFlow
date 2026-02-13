import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {

  // -------------------------------------------------------
  // 1️⃣ Refund execution (refund event header)
  // -------------------------------------------------------
  await knex.schema.createTable('refund_executions', (table) => {

    table
     .uuid('lasyncro_refund_execution_id')
     .primary()

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.string('platform', 255).nullable();
    table.string('external_refund_id', 255).nullable();

    table.decimal('total_refund_amount', 14, 2)
      .notNullable();

    table.timestamp('executed_at', { useTz: true })
      .notNullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
    table.index(['external_refund_id']);
  });


  // -------------------------------------------------------
  // 2️⃣ Refund execution line items (granular mapping)
  // -------------------------------------------------------
  await knex.schema.createTable('refund_execution_line_items', (table) => {

    table
     .uuid('lasyncro_refund_line_item_id')
     .primary()

    table.uuid('lasyncro_refund_execution_id')
      .notNullable()
      .references('lasyncro_refund_execution_id')
      .inTable('refund_executions')
      .onDelete('CASCADE');

    table.uuid('lasyncro_revenue_unit_id')
      .notNullable()
      .references('lasyncro_revenue_unit_id')
      .inTable('order_revenue_units')
      .onDelete('RESTRICT');

    table.integer('refunded_quantity')
      .notNullable();

    table.decimal('refunded_amount', 14, 2)
      .notNullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['lasyncro_refund_execution_id']);
    table.index(['lasyncro_revenue_unit_id']);
  });


  // -------------------------------------------------------
  // 3️⃣ Safety constraint
  // -------------------------------------------------------
  await knex.raw(`
    ALTER TABLE refund_execution_line_items
    ADD CONSTRAINT refund_execution_line_items_quantity_check
    CHECK (refunded_quantity > 0);
  `);

}
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refund_execution_line_items');
  await knex.schema.dropTableIfExists('refund_executions');
}