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