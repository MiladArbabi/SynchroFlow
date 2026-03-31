import { Knex } from 'knex';

/**
 * SHOP SNAPSHOT JOB QUEUE
 * -----------------------
 * Schedules Control Tower snapshot recomputation.
 *
 * Architectural purpose:
 * - decouple reconciliation pipeline from snapshot worker
 * - deduplicate snapshot triggers
 * - allow worker-based execution
 *
 * Invariant:
 * one pending job per shop.
 */
export async function up(knex: Knex): Promise<void> {

  await knex.schema.createTable('shop_snapshot_jobs', (table) => {

    table
      .integer('shop_id')
      .primary()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .timestamp('scheduled_at', { useTz: true })
      .notNullable()
      .comment('Time snapshot recompute was requested');

    /**
     * SYSTEM TIMESTAMPS (QUEUE OBSERVABILITY)
     * --------------------------------------
     * Required for:
     * - tracking job lifecycle
     * - detecting stuck or stale jobs
     * - debugging orchestration issues
     */
    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

   // --- RLS: enforce tenant isolation (queue is per-shop) ---
  await knex.raw(`
    ALTER TABLE shop_snapshot_jobs ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY shop_snapshot_jobs_tenant_isolation
    ON shop_snapshot_jobs
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);

  /**
   * AUTO-UPDATE TRIGGER
   * -------------------
   * Ensures updated_at reflects rescheduling or overwrite.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_shop_snapshot_jobs_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_set_shop_snapshot_jobs_updated_at
    BEFORE UPDATE ON shop_snapshot_jobs
    FOR EACH ROW
    EXECUTE FUNCTION set_shop_snapshot_jobs_updated_at();
  `);

}

export async function down(knex: Knex): Promise<void> {

  // --- RLS cleanup ---
  await knex.raw(`
    DROP POLICY IF EXISTS shop_snapshot_jobs_tenant_isolation ON shop_snapshot_jobs;
  `);

  await knex.schema.dropTableIfExists('shop_snapshot_jobs');

}