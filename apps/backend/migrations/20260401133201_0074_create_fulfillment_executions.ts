import { Knex } from 'knex';

/**
 * fulfillment_executions
 * ----------------------
 * PURPOSE:
 * - Idempotency layer for external fulfillment execution
 * - Audit log of all external side-effects
 *
 * INVARIANTS:
 * - decision_id MUST be unique (1 decision = 1 execution)
 * - NO projection state stored here
 * - Source of truth remains Shopify → webhook → projections
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('fulfillment_executions', (table) => {
    table.uuid('id').primary();

    table.string('decision_id').notNullable().unique(); // idempotency key

    table.string('lasyncro_order_id').notNullable();
    table.string('external_order_id').notNullable();
    table.string('shop_id').notNullable();
    table.index(['shop_id'], 'idx_fulfillment_executions_shop_id');

    table.string('status').notNullable(); // 'pending' | 'success' | 'failure'

    table.text('error').nullable();

    table.timestamp('executed_at').nullable();

    /**
     * EXECUTION TIMESTAMP (CRITICAL)
     * ------------------------------
     * Must be set ONLY after external side-effect succeeds.
     *
     * Prevents:
     * - false audit signals
     * - incorrect execution ordering
     */

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  /**
 * SECURITY INVARIANT:
 * - All access MUST be scoped by shop_id
 * - Enforced via app.current_shop_id
 */

  /**
   * RLS (MANDATORY)
   * ----------------
   * Enforces tenant isolation via shop_id
   */
  await knex.raw(`
    ALTER TABLE fulfillment_executions ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY fulfillment_executions_isolation
    ON fulfillment_executions
    USING (shop_id = current_setting('app.current_shop_id')::text)
    WITH CHECK (shop_id = current_setting('app.current_shop_id')::text);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('fulfillment_executions');
}