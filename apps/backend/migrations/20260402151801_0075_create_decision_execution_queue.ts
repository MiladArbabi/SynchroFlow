import { Knex } from 'knex';

/**
 * ⚠️ DRIFT WARNING (added post DRIFT-AUDIT-01, 2026-07-28)
 * -----------------------------------------------------
 * This migration ran in production on 2026-06-18 (batch 1) BEFORE
 * FORCE ROW LEVEL SECURITY and the split select/write RLS policies
 * were added to this file (2026-06-30, incident fix — a decision
 * execution sat stuck in 'pending' for over an hour with no error).
 * Knex marks this migration complete and will NEVER re-run it — so
 * this file's current `up()` does NOT reflect what actually existed
 * in prod before 2026-07-28.
 *
 * FORCE RLS and the split policies were backfilled into production
 * separately via migration 0131
 * (20260728160000_0131_fix_rls_policy_drift_commands_deq_returnjobs.ts).
 *
 * DO NOT amend this file's `up()` again expecting it to affect prod.
 * Use a new forward migration instead (rule 7).
 */
/**

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