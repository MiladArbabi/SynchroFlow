import { Knex } from 'knex';

/**
 * MIGRATION 0097 — create_receive_jobs
 * --------------------------------------
 * A receive job is created when a PO transitions to `shipped`.
 * It tracks the operator receive session from arrival through stow-ready.
 *
 * Lifecycle: pending → in_progress → inspection → barcode_assignment → stow_ready → closed
 *
 * One receive job per delivery event. Split deliveries on the same PO
 * create multiple receive jobs (linked via po_id).
 *
 * Invariants:
 * - append-only — never delete; cancel via status
 * - actual_delivery_date written here, then propagated to purchase_orders
 * - stow_tasks created automatically on transition to stow_ready
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'receive_job_status'
      ) THEN
        CREATE TYPE receive_job_status AS ENUM (
          'pending',
          'in_progress',
          'inspection',
          'barcode_assignment',
          'stow_ready',
          'closed',
          'cancelled'
        );
      END IF;
    END$$;
  `);

  await knex.schema.createTable('receive_jobs', (table) => {
    table
      .uuid('receive_job_id')
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
      .uuid('po_id')
      .notNullable()
      .references('id')
      .inTable('purchase_orders')
      .onDelete('RESTRICT');

    table
      .specificType('status', 'receive_job_status')
      .notNullable()
      .defaultTo('pending');

    /**
     * Operator assigned to this receive session.
     * Nullable — unassigned until operator claims via alert.
     */
    table
      .integer('assigned_operator_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    /**
     * UNIT COUNTERS
     * -------------
     * Derived from receive_job_lines on session close.
     * Denormalised here for fast dashboard reads.
     */
    table.integer('total_variants').notNullable().defaultTo(0);
    table.integer('total_units').notNullable().defaultTo(0);
    table.integer('units_inspected').notNullable().defaultTo(0);
    table.integer('units_accepted').notNullable().defaultTo(0);
    table.integer('units_rejected').notNullable().defaultTo(0);

    /**
     * Actual delivery date recorded by operator at receive time.
     * Written back to purchase_orders.actual_delivery_date on job close
     * to trigger supplier rating recompute.
     */
    table.date('actual_delivery_date').nullable();

    table.text('notes').nullable();

    table.timestamp('started_at', { useTz: true }).nullable();
    table.timestamp('closed_at', { useTz: true }).nullable();

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.index(['shop_id']);
    table.index(['shop_id', 'status']);
    table.index(['po_id']);
    table.index(['assigned_operator_id']);
  });

  await knex.raw(`ALTER TABLE receive_jobs ENABLE ROW LEVEL SECURITY;`);
  await knex.raw(`ALTER TABLE receive_jobs FORCE ROW LEVEL SECURITY;`);
  await knex.raw(`DROP POLICY IF EXISTS receive_jobs_tenant_isolation_policy ON receive_jobs;`);
  await knex.raw(`
    CREATE POLICY receive_jobs_tenant_isolation_policy
    ON receive_jobs
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('receive_jobs');
  await knex.raw(`DROP TYPE IF EXISTS receive_job_status;`);
}