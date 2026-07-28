import { Knex } from 'knex';

/**
 * MIGRATION 0131 — fix_rls_policy_drift_commands_deq_returnjobs
 * -----------------------------------------------------------------
 * DRIFT-AUDIT-01 forward fix, third instance of the same pattern.
 *
 * commands (0078) and decision_execution_queue (0075) were both
 * batch-1 migrations (2026-06-18) later amended (2026-06-30) to add
 * FORCE ROW LEVEL SECURITY and split select/write RLS policies, after
 * real incidents where a single strict policy silently blocked
 * legitimate cross-tenant infra polls (commands.consumer.ts,
 * execution.dispatcher.worker.ts) — same root cause and same fix
 * shape as order_reconciliation_intents (0037, see migration 0130).
 * Both amendments were silently skipped by Knex since 0075/0078 had
 * already run. Prod is currently missing FORCE RLS entirely on both
 * tables, and commands is also missing WITH CHECK on its one policy —
 * meaning writes to commands are not validated against tenant at all
 * when RLS does apply, on top of the owner-bypass risk from no FORCE.
 *
 * return_jobs (0008, also batch-1) is a separate, simpler case: its
 * single tenant-isolation policy already had WITH CHECK in the
 * migration file at the time 0008 ran — but a later commit
 * (2026-07-04) strengthened the WITH CHECK clause, and that specific
 * amendment was silently skipped the same way. return_jobs already
 * has FORCE RLS in prod; only WITH CHECK is missing.
 *
 * Idempotent: drops and recreates policies unconditionally (DROP
 * POLICY IF EXISTS is always safe), and FORCE RLS is safe to
 * re-issue. No column changes, so no hasColumn/hasTable guards
 * needed — this migration is naturally idempotent by nature of what
 * it does.
 */
export async function up(knex: Knex): Promise<void> {
  // --- commands: FORCE + split select/write policy ---
  await knex.raw(`
    ALTER TABLE commands ENABLE ROW LEVEL SECURITY;
    ALTER TABLE commands FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`
    DROP POLICY IF EXISTS commands_tenant_isolation ON commands;
    DROP POLICY IF EXISTS commands_select_policy ON commands;
    DROP POLICY IF EXISTS commands_write_policy ON commands;
  `);
  await knex.raw(`
    CREATE POLICY commands_select_policy
    ON commands FOR SELECT
    USING (
      shop_id = current_setting('app.current_tenant', true)::int
      OR current_setting('app.current_tenant', true) IN ('', '0')
      OR current_setting('app.current_tenant', true) IS NULL
    );
  `);
  await knex.raw(`
    CREATE POLICY commands_write_policy
    ON commands FOR ALL
    USING (shop_id = current_setting('app.current_tenant', true)::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int);
  `);

  // --- decision_execution_queue: FORCE + split select/write policy ---
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

  // --- return_jobs: add WITH CHECK to existing single policy (FORCE already present) ---
  await knex.raw(`DROP POLICY IF EXISTS return_jobs_tenant_isolation ON return_jobs;`);
  await knex.raw(`
    CREATE POLICY return_jobs_tenant_isolation
    ON return_jobs
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Revert to the original single-policy shape each table had at
  // batch-1 run time (pre-amendment prod state). Not a full rollback
  // to "no RLS" — that would be actively unsafe.
  await knex.raw(`
    DROP POLICY IF EXISTS commands_select_policy ON commands;
    DROP POLICY IF EXISTS commands_write_policy ON commands;
    CREATE POLICY commands_tenant_isolation
    ON commands
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
  await knex.raw(`ALTER TABLE commands NO FORCE ROW LEVEL SECURITY;`);

  await knex.raw(`
    DROP POLICY IF EXISTS decision_execution_queue_select_policy ON decision_execution_queue;
    DROP POLICY IF EXISTS decision_execution_queue_write_policy ON decision_execution_queue;
    CREATE POLICY decision_execution_queue_isolation
    ON decision_execution_queue
    USING (shop_id = current_setting('app.current_tenant')::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
  `);
  await knex.raw(`ALTER TABLE decision_execution_queue NO FORCE ROW LEVEL SECURITY;`);

  await knex.raw(`
    DROP POLICY IF EXISTS return_jobs_tenant_isolation ON return_jobs;
    CREATE POLICY return_jobs_tenant_isolation
    ON return_jobs
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}
