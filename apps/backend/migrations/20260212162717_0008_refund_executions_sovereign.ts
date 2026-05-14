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
    // Drives: resellable → restow, repackable → Problem Center, damaged/unsellable → owner alert.
    table.specificType('item_condition', 'return_item_condition_type').nullable();

    // Actual units physically received back — may differ from refunded_quantity.
    // e.g. customer claimed 3 units but only 2 arrived → shortfall → Problem Center task.
    table.integer('quantity_received').nullable();

    // Free text set by operator during mobile returns scan.
    // Required when item_condition = 'damaged' or 'unsellable'.
    table.text('condition_notes').nullable();

    // Operator who assessed this line item on mobile.
    // Plain integer — no FK (users table created in 0010, after this migration).
    // Application layer enforces valid user id.
    table.integer('processed_by').nullable();

    table.timestamp('processed_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true })

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

  // -------------------------------------------------------
  // 4️⃣ Return job origin enum
  // -------------------------------------------------------
  // customer_return   — customer sent item back, refund_execution exists
  // undelivered_return — carrier returned package, never reached customer, no refund yet
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_job_origin_type') THEN
        CREATE TYPE return_job_origin_type AS ENUM (
          'customer_return',
          'undelivered_return'
        );
      END IF;
    END$$;
  `);

  // Why an undelivered package came back. Nullable — only set for undelivered_return origin.
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'undelivered_reason_type') THEN
        CREATE TYPE undelivered_reason_type AS ENUM (
          'wrong_address',
          'not_claimed',
          'customs',
          'carrier_error',
          'other'
        );
      END IF;
    END$$;
  `);

  // Owner decision on a return job requiring action.
  // Set on web (ReturnsItemsPage) after operator flags item or undelivered package arrives.
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_owner_decision_type') THEN
        CREATE TYPE return_owner_decision_type AS ENUM (
          'reship',
          'contact_customer',
          'initiate_refund',
          'write_off'
        );
      END IF;
    END$$;
  `);

  // -------------------------------------------------------
  // 5️⃣ return_jobs — physical return processing jobs
  // -------------------------------------------------------
  // One job per physical return event.
  // Type A (customer_return): linked to refund_execution, operator processes item condition.
  // Type B (undelivered_return): linked to order, no refund yet, owner decides next action.
  //
  // Cascade chain:
  //   resellable     → stow_task created, inventory_movement +qty
  //   repackable     → problem_center_task (type: repackaging_required)
  //   damaged        → owner alert, ReturnsItemsPage "Needs your decision"
  //   unsellable     → owner alert, write-off pending approval
  //   undelivered    → order blocked (block_type: returned_undelivered), owner alert
  await knex.schema.createTable('return_jobs', (table) => {
    table
      .uuid('return_job_id')
      .primary()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    // Origin determines which FK is populated and which flow applies.
    table
      .specificType('origin', 'return_job_origin_type')
      .notNullable();

    // Type A — customer_return: must be set. Type B — null at creation, set if refund later issued.
    table
      .uuid('lasyncro_refund_execution_id')
      .nullable()
      .references('lasyncro_refund_execution_id')
      .inTable('refund_executions')
      .onDelete('SET NULL');

    // Type B — undelivered_return: must be set. Type A — also set (via refund_execution → order).
    // Denormalised here for direct order blocking without joining through refund.
    table
      .uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table
      .string('status', 50)
      .notNullable()
      .defaultTo('pending');
    // status values: pending | in_progress | awaiting_decision | complete

    // Type B only — why the carrier returned the package.
    table
      .specificType('undelivered_reason', 'undelivered_reason_type')
      .nullable();

    // Owner decision — set on web after operator flags or undelivered package arrives.
    table
      .specificType('owner_decision', 'return_owner_decision_type')
      .nullable();

    table.text('decision_notes').nullable();

    // Plain integer — no FK (users table created in 0010, after this migration).
    table.integer('decision_by').nullable();

    table.timestamp('decision_at', { useTz: true }).nullable();

    // Operator who claimed and processed this job on mobile.
    // Plain integer — no FK (users table created in 0010, after this migration).
    table.integer('claimed_by').nullable();

    table.timestamp('claimed_at', { useTz: true }).nullable();
    table.timestamp('completed_at', { useTz: true }).nullable();

    table.text('notes').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['shop_id', 'status']);
    table.index(['lasyncro_order_id']);
    table.index(['lasyncro_refund_execution_id']);

    // No unique constraint here — enforced at application layer:
    // - undelivered_return: service checks for existing active job before creating
    // - customer_return: one job per refund_execution (enforced via FK uniqueness on refund_execution_id)
    // DB-level unique on refund_execution_id prevents duplicate processing jobs per refund.
    table.unique(
      ['lasyncro_refund_execution_id'],
      'return_jobs_refund_execution_unique'
    );
  });

  await knex.raw(`ALTER TABLE return_jobs ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE return_jobs FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS return_jobs_tenant_isolation ON return_jobs;`);
  await knex.raw(`
    CREATE POLICY return_jobs_tenant_isolation
    ON return_jobs
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('return_jobs');
  await knex.schema.dropTableIfExists('refund_execution_line_items');
  await knex.schema.dropTableIfExists('refund_executions');
  await knex.raw(`DROP TYPE IF EXISTS return_owner_decision_type`);
  await knex.raw(`DROP TYPE IF EXISTS undelivered_reason_type`);
  await knex.raw(`DROP TYPE IF EXISTS return_job_origin_type`);
  await knex.raw(`DROP TYPE IF EXISTS return_item_condition_type`);
  await knex.raw(`DROP TYPE IF EXISTS return_reason_type`);
}