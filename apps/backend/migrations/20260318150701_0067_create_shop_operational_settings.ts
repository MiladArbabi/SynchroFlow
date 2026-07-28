import { Knex } from 'knex';

/**
 * ⚠️ DRIFT WARNING (added post DRIFT-AUDIT-01, 2026-07-28)
 * -----------------------------------------------------
 * This migration ran in production on 2026-06-18 (batch 1) BEFORE
 * returns_aging_warning_hours and returns_aging_critical_hours were
 * added to this file. Knex marks this migration complete and will
 * NEVER re-run it — so this file's current `up()` does NOT reflect
 * what actually existed in prod before 2026-07-28.
 *
 * Note also: this table never had FORCE ROW LEVEL SECURITY in this
 * file at any point — that's a separate, pre-existing gap (not
 * drift), logged as a follow-up rather than fixed here.
 *
 * Both columns were backfilled into production separately via
 * migration 0132
 * (20260728170000_0132_backfill_missing_columns_suppliers_shopopsettings.ts).
 *
 * DO NOT amend this file's `up()` again expecting it to affect prod.
 * Use a new forward migration instead (rule 7).
 */

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
     * CARRIER PICKUP TIME (CPT)
     * -------------------------
     * daily_cpt_local: time when carrier collects (e.g. '16:00').
     * Drives Zone 1 CPT countdown and required-UPH calculation.
     * Stored as TIME in shop's local timezone (daily_cpt_timezone on shop).
     * Null = no CPT configured — countdown hidden in Zone 1.
     */
    table.time('daily_cpt_local').nullable();

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
    /**
     * RETURNS AGING THRESHOLDS (HOURS)
     * ---------------------------------
     * When an unclaimed/unprocessed return job counts as "aging" vs
     * "critical" for orphan-detection surfacing (Returns Sprint 2).
     */
    table.integer('returns_aging_warning_hours').notNullable().defaultTo(48);
    table.integer('returns_aging_critical_hours').notNullable().defaultTo(168);
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