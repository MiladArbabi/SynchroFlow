import { Knex } from 'knex';

/**
 * decision_execution_queue
 * ------------------------
 * PURPOSE:
 * - Stores manual execution decisions
 * - Enables user-triggered execution
 *
 * INVARIANTS:
 * - decision_id is unique (1 decision = 1 pending execution)
 * - status tracks lifecycle: pending → dispatched → in_progress → success | failure
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('decision_execution_queue', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    /**
     * INVARIANT (CRITICAL)
     * --------------------
     * One decision = one execution entry.
     * Prevents duplicate manual execution.
     */
    table.string('decision_id').notNullable().unique();
    table.string('status').notNullable(); // 'pending' | 'dispatched' | 'in_progress' | 'success' | 'failure'

    table.integer('shop_id').notNullable();

    table.index(['shop_id'], 'idx_decision_execution_queue_shop_id');

    table.text('error').nullable();

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('executed_at').nullable();

  });

  /**
   * RLS (MANDATORY)
   *
   * SPLIT POLICY (THREAD A-2 cont'd, 2026-06-30): execution.dispatcher.worker.ts
   * polls PENDING rows ACROSS ALL TENANTS — same genuine cross-tenant
   * infra-scan shape as order_reconciliation_intents and commands (see
   * those tables' migrations for the full incident writeup). The
   * original single strict policy made this poll silently return zero
   * rows under FORCE RLS with no tenant context set — confirmed live,
   * 2026-06-30: a real decision execution sat stuck in 'pending' for
   * over an hour with the worker process healthy and running the
   * entire time, no error, no log output.
   */
  await knex.raw(`
    ALTER TABLE decision_execution_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE decision_execution_queue FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`
    DROP POLICY IF EXISTS decision_execution_queue_isolation ON decision_execution_queue;
    DROP POLICY IF EXISTS decision_execution_queue_select_policy ON decision_execution_queue;
    DROP POLICY IF EXISTS decision_execution_queue_write_policy ON decision_execution_queue;
  `);
  await knex.raw(`
    CREATE POLICY decision_execution_queue_select_policy
    ON decision_execution_queue FOR SELECT
    USING (
      shop_id = current_setting('app.current_tenant', true)::int
      OR current_setting('app.current_tenant', true) IN ('', '0')
      OR current_setting('app.current_tenant', true) IS NULL
    );
  `);
  await knex.raw(`
    CREATE POLICY decision_execution_queue_write_policy
    ON decision_execution_queue FOR ALL
    USING (shop_id = current_setting('app.current_tenant', true)::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('decision_execution_queue');
}