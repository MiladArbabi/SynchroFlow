import { Knex } from 'knex';

/**
 * ⚠️ DRIFT WARNING (added post DRIFT-AUDIT-01, 2026-07-28)
 * -----------------------------------------------------
 * This migration ran in production on 2026-06-18 (batch 1) BEFORE
 * 'return_restock' was added to stow_task_trigger. Knex marks this
 * migration complete and will NEVER re-run it — so this file's
 * current `up()` does NOT reflect what actually existed in prod
 * before 2026-07-28.
 *
 * The missing enum value was backfilled into production separately
 * via migration 0133
 * (20260728180000_0133_backfill_enum_values_fulfillment_stow.ts).
 *
 * DO NOT amend this file's `up()` again expecting it to affect prod.
 * Use a new forward migration instead (rule 7).
 */
/**

/**
 * MIGRATION 0084 — create_stow_tasks
 * ------------------------------------
 * Stow tasks are generated automatically when:
 * - An order is cancelled mid-pick (WM-14)
 * - Stock is received and needs to be stowed (WM-05)
 *
 * A stow task instructs an operator to physically return
 * or place a variant to its warehouse location.
 *
 * Completion writes an `inbound_purchase` movement to inventory_movements.
 *
 * Invariants:
 * - append-only intent — never delete stow tasks; cancel them
 * - one operator owns a stow task at a time (claimed_by)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'stow_task_status'
      ) THEN
        CREATE TYPE stow_task_status AS ENUM (
          'pending',
          'in_progress',
          'completed',
          'cancelled'
        );
      END IF;
    END$$;
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'stow_task_trigger'
      ) THEN
        CREATE TYPE stow_task_trigger AS ENUM (
          'order_cancelled_mid_pick',
          'inbound_stock',
          'problem_center',
          'return_restock'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('stow_tasks', (table) => {
    table
      .uuid('stow_task_id')
      .primary()
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable();

    table
      .integer('quantity')
      .notNullable();

    /**
     * Target stow location. Nullable at creation — assigned during suggestion (WM-36)
     * or manually by operator before claiming.
     */
    table
      .string('location_code', 255)
      .nullable();

    table
      .specificType('status', 'stow_task_status')
      .notNullable()
      .defaultTo('pending');

    table
      .specificType('trigger', 'stow_task_trigger')
      .notNullable();

    /**
     * Source context — nullable depending on trigger.
     * Populated when trigger = order_cancelled_mid_pick.
     */
    table
      .uuid('pick_batch_id')
      .nullable()
      .references('pick_batch_id')
      .inTable('pick_batches')
      .onDelete('SET NULL');

    /**
     * Source PO for inbound_stock trigger (FEAT-004).
     * No FK — purchase_orders is created in migration 0095 (after this).
     * Integrity enforced at application layer in receiveJob.service.ts.
     */
    table
      .uuid('po_id')
      .nullable();
    /**
     * Source problem_center_tasks ID when trigger = problem_center.
     * No FK — problem_center_tasks created in migration 0103 (after this).
     */
    table
      .uuid('source_task_id')
      .nullable();

    table
      .uuid('lasyncro_order_id')
      .nullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('SET NULL');

    /**
     * OPERATOR OWNERSHIP
     * ------------------
     * Single operator owns the stow task at a time.
     * claimed_at used for idle alert threshold.
     */
    table
      .integer('claimed_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    table.timestamp('claimed_at', { useTz: true }).nullable();
    table.timestamp('completed_at', { useTz: true }).nullable();

    /**
     * Inventory movement written on completion.
     * Stored for audit trail — movement is immutable once written.
     */
    table
      .uuid('inventory_movement_id')
      .nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['shop_id', 'status']);
    table.index(['lasyncro_variant_id']);
    table.index(['claimed_by']);
  });

  await knex.raw(`
    ALTER TABLE stow_tasks ENABLE ROW LEVEL SECURITY;
    ALTER TABLE stow_tasks FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS stow_tasks_tenant_isolation_policy ON stow_tasks;
  `);

  await knex.raw(`
    CREATE POLICY stow_tasks_tenant_isolation_policy
    ON stow_tasks
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('stow_tasks');
  await knex.raw(`DROP TYPE IF EXISTS stow_task_status;`);
  await knex.raw(`DROP TYPE IF EXISTS stow_task_trigger;`);
}