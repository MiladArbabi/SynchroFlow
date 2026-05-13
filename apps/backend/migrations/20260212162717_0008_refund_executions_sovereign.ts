import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {

  // -------------------------------------------------------
  // 0️⃣ Enums
  // -------------------------------------------------------

  // return_reason: why the customer returned the item.
  // Captured at header level — one reason per return event.
  // Future: mobile returns workflow prompts operator to select
  // reason + photograph condition during inbound scan.
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_reason_type') THEN
        CREATE TYPE return_reason_type AS ENUM (
          'wrong_item',
          'damaged_in_transit',
          'damaged_on_arrival',
          'not_as_described',
          'quality_issue',
          'changed_mind',
          'duplicate_order',
          'other'
        );
      END IF;
    END$$;
  `);

  // item_condition: physical state assessed by operator per returned unit.
  // Captured at line-item level — drives restow vs write-off decision.
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_item_condition_type') THEN
        CREATE TYPE return_item_condition_type AS ENUM (
          'resellable',
          'repackable',
          'damaged',
          'unsellable'
        );
      END IF;
    END$$;
  `);

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

    // Why the customer returned — nullable for platform-synced refunds
    // where reason was not captured. Operator sets on mobile returns flow.
    table.specificType('return_reason', 'return_reason_type').nullable();

    // Free-text notes — required when return_reason = 'other'.
    // Also used for carrier claim reference numbers on damaged_in_transit.
    table.text('return_notes').nullable();

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

    // Physical condition of this returned unit assessed by operator.
    // Nullable — set during mobile returns inbound scan, not at refund creation.
    // Drives: resellable → restow, damaged/unsellable → write-off alert.
    table.specificType('item_condition', 'return_item_condition_type').nullable();

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
  await knex.raw(`DROP TYPE IF EXISTS return_item_condition_type`);
  await knex.raw(`DROP TYPE IF EXISTS return_reason_type`);
}