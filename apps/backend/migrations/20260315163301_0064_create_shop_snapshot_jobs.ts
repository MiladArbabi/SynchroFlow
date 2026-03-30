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

}

export async function down(knex: Knex): Promise<void> {

  // --- RLS cleanup ---
  await knex.raw(`
    DROP POLICY IF EXISTS shop_snapshot_jobs_tenant_isolation ON shop_snapshot_jobs;
  `);

  await knex.schema.dropTableIfExists('shop_snapshot_jobs');

}