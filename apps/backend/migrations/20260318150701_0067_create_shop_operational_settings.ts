import { Knex } from 'knex';

/**
 * SHOP OPERATIONAL SETTINGS
 * -------------------------
 * Defines fulfillment SLA contract per shop.
 *
 * This is NOT a preference.
 * This is a deterministic system input used in projections.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shop_operational_settings', (table) => {
    table.integer('shop_id').primary();

    /**
     * FULFILLMENT SLA (HOURS)
     * ------------------------
     * Maximum allowed time between payment and fulfillment.
     *
     * Used by:
     * - order operational constraint projection
     */
    table.integer('fulfillment_sla_hours').notNullable().defaultTo(24);
    /**
     * CASH FLOW PROJECTION INPUTS
     * ---------------------------
     * monthly_overhead_amount: fixed monthly costs (rent, salaries, etc.)
     *   Deducted weekly in cash flow projection.
     * starting_cash_balance: anchor point for projection curve.
     * starting_cash_balance_set_at: when the balance was last manually set.
     */
    table.decimal('monthly_overhead_amount', 14, 2).notNullable().defaultTo(0);
    table.decimal('starting_cash_balance', 14, 2).notNullable().defaultTo(0);
    table.timestamp('starting_cash_balance_set_at', { useTz: true }).nullable();
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  // --- RLS: enforce tenant isolation (per-shop configuration) ---
  await knex.raw(`
    ALTER TABLE shop_operational_settings ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY shop_operational_settings_tenant_isolation
    ON shop_operational_settings
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // --- RLS cleanup ---
  await knex.raw(`
    DROP POLICY IF EXISTS shop_operational_settings_tenant_isolation ON shop_operational_settings;
  `);
  
  await knex.schema.dropTableIfExists('shop_operational_settings');
}