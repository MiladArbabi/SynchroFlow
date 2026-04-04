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
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS commands_tenant_isolation ON commands;
  `);

  await knex.raw(`
    CREATE POLICY commands_tenant_isolation
    ON commands
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('commands');
}