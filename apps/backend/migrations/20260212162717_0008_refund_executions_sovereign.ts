import type { Knex } from "knex";

/**
 * ⚠️ DRIFT WARNING (added post DRIFT-AUDIT-01, 2026-07-28)
 * -----------------------------------------------------
 * This migration ran in production on 2026-06-18 (batch 1) BEFORE
 * return_jobs' tenant-isolation policy's WITH CHECK clause was
 * strengthened (2026-07-04). Knex marks this migration complete and
 * will NEVER re-run it — so this file's current `up()` does NOT
 * reflect what actually existed in prod before 2026-07-28.
 *
 * The strengthened WITH CHECK clause was backfilled into production
 * separately via migration 0131
 * (20260728160000_0131_fix_rls_policy_drift_commands_deq_returnjobs.ts).
 *
 * DO NOT amend this file's `up()` again expecting it to affect prod.
 * Use a new forward migration instead (rule 7). Note this file also
 * creates refund_executions and refund_execution_line_items — this
 * warning applies to the whole file's up(), not just return_jobs.
 */
export async function up(knex: Knex): Promise<void> {

  // -------------------------------------------------------
  // 0️⃣ Enums (all, moved up front — line items below now need
  //    return_owner_decision_type before it existed further down
  //    in the original file order)
  // -------------------------------------------------------

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_reason_type') THEN
        CREATE TYPE return_reason_type AS ENUM (
          'wrong_item', 'damaged_in_transit', 'damaged_on_arrival',
          'not_as_described', 'quality_issue', 'changed_mind',
          'duplicate_order', 'other'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_item_condition_type') THEN
        CREATE TYPE return_item_condition_type AS ENUM (
          'resellable', 'repackable', 'damaged', 'unsellable'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_job_origin_type') THEN
        CREATE TYPE return_job_origin_type AS ENUM (
          'customer_return', 'undelivered_return'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'undelivered_reason_type') THEN
        CREATE TYPE undelivered_reason_type AS ENUM (
          'wrong_address', 'not_claimed', 'customs', 'carrier_error', 'other'
        );
      END IF;
    END$$;
  `);

  // Owner decision — now settable per LINE (see refund_execution_line_items
  // below), not per job. A multi-line order can have different lines
  // dispositioned differently (one reshipped, one written off) — the
  // original per-job design couldn't express that.
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'return_owner_decision_type') THEN
        CREATE TYPE return_owner_decision_type AS ENUM (
          'reship', 'contact_customer', 'initiate_refund', 'write_off'
        );
      END IF;
    END$$;
  `);

  // -------------------------------------------------------
  // 1️⃣ Refund execution (refund event header)
  // -------------------------------------------------------
  await knex.schema.createTable('refund_executions', (table) => {
    table.uuid('lasyncro_refund_execution_id').primary();

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.string('platform', 255).notNullable();
    table.string('external_refund_id', 255).notNullable();
    table.unique(['platform', 'external_refund_id'], 'refund_executions_platform_external_unique');

    table.decimal('total_refund_amount', 14, 2).notNullable();
    table.timestamp('executed_at', { useTz: true }).notNullable();

    // Why the customer returned — nullable for platform-synced refunds
    // where reason was not captured. Operator sets via WMS free-scan
    // return processing, at job completion (not per-line — one reason
    // per return event, distinct from per-line owner_decision below).
    table.specificType('return_reason', 'return_reason_type').nullable();
    table.text('return_notes').nullable();

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['lasyncro_order_id']);
    table.index(['external_refund_id']);
  });

  await knex.raw(`
    ALTER TABLE refund_executions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE refund_executions FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`DROP POLICY IF EXISTS refund_executions_tenant_isolation_policy ON refund_executions;`);
  await knex.raw(`
    CREATE POLICY refund_executions_tenant_isolation_policy
    ON refund_executions
    USING (
      lasyncro_order_id IN (
        SELECT lasyncro_order_id FROM orders
        WHERE shop_id = current_setting('app.current_tenant')::int
      )
    );
  `);

  // -------------------------------------------------------
  // 2️⃣ Refund execution line items (granular mapping)
  // -------------------------------------------------------
  await knex.schema.createTable('refund_execution_line_items', (table) => {
    table.uuid('lasyncro_refund_line_item_id').primary();

    // Nullable — a line can exist before any refund does (scan-intake:
    // operator physically receives an item before Shopify's refund
    // webhook has fired, or ever fires at all). Originally NOT NULL;
    // relaxed here directly rather than via a later patch migration.
    table.uuid('lasyncro_refund_execution_id')
      .nullable()
      .references('lasyncro_refund_execution_id')
      .inTable('refund_executions')
      .onDelete('CASCADE');

    table.uuid('lasyncro_revenue_unit_id')
      .notNullable()
      .references('lasyncro_revenue_unit_id')
      .inTable('order_revenue_units')
      .onDelete('RESTRICT');

    table.integer('refunded_quantity').notNullable();

    // Nullable — a scan-intake line created pre-refund has no refund
    // amount to derive yet. Originally NOT NULL; relaxed here directly.
    table.decimal('refunded_amount', 14, 2).nullable();

    // Physical condition of this returned unit, assessed by operator.
    // Drives: resellable → restow, repackable → Problem Center,
    // damaged/unsellable → owner decision (below).
    table.specificType('item_condition', 'return_item_condition_type').nullable();

    table.integer('quantity_received').nullable();
    table.text('condition_notes').nullable();

    // Plain integer — no FK (users table created in migration 0010,
    // after this one).
    table.integer('processed_by').nullable();
    table.timestamp('processed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // return_job_id: the only link back to anything for a scan-intake
    // line with no refund yet. FK added below via alterTable, once
    // return_jobs exists (this table is created before it, per the
    // section ordering in this file).
    table.uuid('return_job_id').nullable();

    // 'refund_webhook' (normal path, refund arrived first) |
    // 'scan_intake_manual' (operator scanned the physical item before
    // any refund existed).
    table.string('source', 50).notNullable().defaultTo('refund_webhook');

    // OWNER DECISION — per line, not per job. Moved down from
    // return_jobs (see enum comment above) so a multi-line order can
    // have each damaged/unsellable line dispositioned independently.
    // return_jobs keeps its own owner_decision/decision_* columns
    // (below) for backward-compat with the mobile list view, which
    // reads a job-level summary — but nothing in the web app writes
    // to those columns anymore as of this schema.
    table.specificType('owner_decision', 'return_owner_decision_type').nullable();
    table.text('decision_notes').nullable();
    table.integer('decision_by').nullable();
    table.timestamp('decision_at', { useTz: true }).nullable();

    table.index(['lasyncro_refund_execution_id']);
    table.index(['lasyncro_revenue_unit_id']);
    table.index(['return_job_id']);

    table.unique(
      ['lasyncro_refund_execution_id', 'lasyncro_revenue_unit_id'],
      'refund_execution_line_items_execution_ru_unique'
    );
  });

  await knex.raw(`
    ALTER TABLE refund_execution_line_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE refund_execution_line_items FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`DROP POLICY IF EXISTS refund_execution_line_items_tenant_isolation_policy ON refund_execution_line_items;`);
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

  // -------------------------------------------------------
  // 3️⃣ Safety constraint
  // -------------------------------------------------------
  await knex.raw(`
    ALTER TABLE refund_execution_line_items
    ADD CONSTRAINT refund_execution_line_items_quantity_check
    CHECK (refunded_quantity > 0);
  `);

  // -------------------------------------------------------
  // 4️⃣ return_jobs — physical return processing jobs
  // -------------------------------------------------------
  // One job per physical return event.
  // Type A (customer_return): linked to refund_execution, operator processes item condition.
  // Type B (undelivered_return): linked to order, no refund yet, owner decides next action.
  //
  // Cascade chain (per LINE, see refund_execution_line_items above):
  //   resellable  → stow_task created, inventory_movement +qty
  //   repackable  → problem_center_task (type: repackaging_required)
  //   damaged     → owner decision needed on that line
  //   unsellable  → owner decision needed on that line
  //   undelivered → order blocked (block_type: returned_undelivered), owner alert
  await knex.schema.createTable('return_jobs', (table) => {
    table.uuid('return_job_id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.specificType('origin', 'return_job_origin_type').notNullable();

    table.uuid('lasyncro_refund_execution_id')
      .nullable()
      .references('lasyncro_refund_execution_id')
      .inTable('refund_executions')
      .onDelete('SET NULL');

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.string('status', 50).notNullable().defaultTo('pending');
    // status values: pending | in_progress | awaiting_decision | complete

    table.specificType('undelivered_reason', 'undelivered_reason_type').nullable();

    // Job-level decision fields — legacy/summary only as of this schema.
    // Mobile's listReturnJobs() still reads these for its job-list view.
    // The web app now writes decisions per LINE (refund_execution_line_items
    // above), not here. Kept rather than dropped to avoid a breaking
    // change to the mobile read path in this same migration.
    table.specificType('owner_decision', 'return_owner_decision_type').nullable();
    table.text('decision_notes').nullable();
    table.integer('decision_by').nullable();
    table.timestamp('decision_at', { useTz: true }).nullable();

    table.integer('claimed_by').nullable();
    table.timestamp('claimed_at', { useTz: true }).nullable();
    table.timestamp('completed_at', { useTz: true }).nullable();
    table.text('notes').nullable();

    // Why the customer returned — captured at job completion (operator
    // has maximum context by then: every line assessed, any enclosed
    // note read). Lives here, not only on refund_executions, because a
    // scan-intake job (WEB-RETURN-01) can complete before its refund
    // webhook ever arrives — return_reason has nowhere to persist if it
    // only exists on the refund row. Backfilled onto refund_executions
    // at link time (refunds.create.ts) once/if a refund does arrive.
    table.specificType('return_reason', 'return_reason_type').nullable();
    table.text('return_notes').nullable();

    // Who/what created this job. 'operator' (mobile/web scan, default) |
    // 'carrier_webhook' (auto-created from a parcel_tracking_events
    // 'returned' event) | 'system_auto' (auto-spawned by the refund
    // projection handler) | 'scan_intake' (WMS free-scan, pre-refund).
    table.string('source', 20).notNullable().defaultTo('operator');

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['shop_id', 'status']);
    table.index(['shop_id', 'source']);
    table.index(['lasyncro_order_id']);
    table.index(['lasyncro_refund_execution_id']);

    table.unique(['lasyncro_refund_execution_id'], 'return_jobs_refund_execution_unique');
  });

  await knex.raw(`ALTER TABLE return_jobs ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE return_jobs FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS return_jobs_tenant_isolation ON return_jobs;`);
  await knex.raw(`
    CREATE POLICY return_jobs_tenant_isolation
    ON return_jobs
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);

  // -------------------------------------------------------
  // 5️⃣ Now that return_jobs exists, wire refund_execution_line_items
  //    .return_job_id (declared nullable, no FK, in section 2 above)
  // -------------------------------------------------------
  await knex.schema.alterTable('refund_execution_line_items', (table) => {
    table.foreign('return_job_id')
      .references('return_job_id')
      .inTable('return_jobs')
      .onDelete('CASCADE');
  });
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