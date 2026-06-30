import type { Knex } from "knex";

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