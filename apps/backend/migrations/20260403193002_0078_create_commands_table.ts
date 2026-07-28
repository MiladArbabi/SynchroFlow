import type { Knex } from "knex";

/**
 * ⚠️ DRIFT WARNING (added post DRIFT-AUDIT-01, 2026-07-28)
 * -----------------------------------------------------
 * This migration ran in production on 2026-06-18 (batch 1) BEFORE
 * FORCE ROW LEVEL SECURITY and the split select/write RLS policies
 * were added to this file (2026-06-30, incident fix — same cross-
 * tenant polling failure class as order_reconciliation_intents and
 * decision_execution_queue). Knex marks this migration complete and
 * will NEVER re-run it — so this file's current `up()` does NOT
 * reflect what actually existed in prod before 2026-07-28.
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
 * COMMAND BUS — SOURCE OF TRUTH FOR INTENT
 * ----------------------------------------
 * Guarantees:
 * - idempotency across system + user actions
 * - replay-safe command processing
 * - single control plane (NO DECISION WITHOUT COMMAND)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('commands', (table) => {
    table.uuid('id').primary();

    table.string('type').notNullable();

    table.jsonb('payload').nullable();

    /**
     * Deterministic idempotency key
     * REQUIRED for:
     * - reconciliation commands
     * - user-triggered actions
     */
    table.string('idempotency_key').notNullable().unique();

    /**
     * Lifecycle tracking
     */
    table.string('status').notNullable().defaultTo('pending');
    // pending | processed | superseded

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('processed_at').nullable();

    /**
     * Observability
     */
    table.text('error').nullable();

    table.index(['shop_id', 'status'], 'idx_commands_shop_status');

    /**
     * TENANT IDENTITY (MANDATORY)
     * --------------------------
     * Required for RLS enforcement
     */
    table.integer('shop_id').notNullable();
  });

  /**
   * ROW LEVEL SECURITY (MANDATORY)
   * ------------------------------
   * Enforces strict tenant isolation.
   */
  await knex.raw(`
    ALTER TABLE commands ENABLE ROW LEVEL SECURITY;
    ALTER TABLE commands FORCE ROW LEVEL SECURITY;
  `);

  // SPLIT POLICY (THREAD A, 2026-06-30): commands.consumer.ts must poll
  // PENDING commands ACROSS ALL TENANTS to discover what needs
  // processing — a genuine cross-tenant infra scan, same shape as
  // order_reconciliation_intents (see that table's 0037 migration for
  // the full incident writeup). The original single strict policy would
  // make this poll silently return zero rows under FORCE RLS with no
  // tenant context set — same failure mode confirmed live earlier
  // tonight on a different table, caught here before it shipped broken.
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
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('commands');
}