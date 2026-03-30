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

    table.string('platform', 255).notNullable();

    table.string('external_refund_id', 255)
      .notNullable();

    table.unique(
      ['platform', 'external_refund_id'],
      'refund_executions_platform_external_unique'
    );

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

  // --- RLS: Enforce tenant isolation (via orders) ---
  await knex.raw(`
    ALTER TABLE refund_executions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE refund_executions FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS refund_executions_tenant_isolation_policy ON refund_executions;
  `);

  await knex.raw(`
    CREATE POLICY refund_executions_tenant_isolation_policy
    ON refund_executions
    USING (
      lasyncro_order_id IN (
        SELECT lasyncro_order_id
        FROM orders
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  // NOTE:
  // No direct shop_id → enforce via orders

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

    table.unique(
      ['lasyncro_refund_execution_id', 'lasyncro_revenue_unit_id'],
      'refund_execution_line_items_execution_ru_unique'
    );
  });

  // --- RLS: Enforce tenant isolation (via revenue_units → orders) ---
  await knex.raw(`
    ALTER TABLE refund_execution_line_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE refund_execution_line_items FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS refund_execution_line_items_tenant_isolation_policy ON refund_execution_line_items;
  `);

  await knex.raw(`
    CREATE POLICY refund_execution_line_items_tenant_isolation_policy
    ON refund_execution_line_items
    USING (
      lasyncro_revenue_unit_id IN (
        SELECT ru.lasyncro_revenue_unit_id
        FROM order_revenue_units ru
        JOIN orders o ON o.lasyncro_order_id = ru.lasyncro_order_id
        WHERE o.shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  // NOTE:
  // 2-hop enforcement:
  // refund_execution_line_items → order_revenue_units → orders → shop_id
  // Prevents indirect cross-tenant financial leakage

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