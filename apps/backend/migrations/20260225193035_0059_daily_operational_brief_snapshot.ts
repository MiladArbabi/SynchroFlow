import { Knex } from 'knex';

/**
 * SNAPSHOT: daily_operational_brief_snapshot
 * ------------------------------------------
 * Materialized during reconciliation.
 *
 * Semantic Contract:
 * Daily compression layer for operational + financial urgency.
 *
 * Guarantees:
 * - One row per (shop_id, brief_date)
 * - Replace-on-reconcile
 * - Fully derived
 * - No runtime mutation
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('daily_operational_brief_snapshot', (table) => {
    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.date('brief_date')
      .notNullable();

    table.integer('critical_orders_count')
      .notNullable()
      .defaultTo(0);

    table.integer('negative_margin_orders_count')
      .notNullable()
      .defaultTo(0);

    table.integer('sla_breached_count')
      .notNullable()
      .defaultTo(0);

    table.decimal('inventory_blocked_revenue', 14, 2)
      .notNullable()
      .defaultTo(0);

    table.decimal('cash_realized_today', 14, 2)
      .notNullable()
      .defaultTo(0);

    table.decimal('refund_exposure', 14, 2)
      .notNullable()
      .defaultTo(0);

    table.jsonb('top_10_priority_order_ids')
      .notNullable()
      .defaultTo('[]');

    table.timestamp('evaluated_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    /**
     * SYSTEM TIMESTAMPS (REQUIRED FOR SNAPSHOT CONSISTENCY)
     * ----------------------------------------------------
     * Required for:
     * - ON CONFLICT DO UPDATE compatibility
     * - deterministic reconciliation overwrite tracking
     * - observability and audit
     */
    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['shop_id', 'brief_date']);
  });

  // --- RLS: enforce tenant isolation (snapshot is tenant-scoped via shop_id) ---
  await knex.raw(`
    ALTER TABLE daily_operational_brief_snapshot ENABLE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    CREATE POLICY daily_operational_brief_snapshot_tenant_isolation
    ON daily_operational_brief_snapshot
    USING (shop_id = current_setting('app.current_tenant')::int);
  `);

  /**
   * AUTO-UPDATE TRIGGER
   * -------------------
   * Ensures updated_at reflects reconciliation overwrite.
   */
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_daily_operational_brief_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await knex.raw(`
    CREATE TRIGGER trg_set_daily_operational_brief_updated_at
    BEFORE UPDATE ON daily_operational_brief_snapshot
    FOR EACH ROW
    EXECUTE FUNCTION set_daily_operational_brief_updated_at();
  `);

  await knex.schema.alterTable('daily_operational_brief_snapshot', (table) => {
    table.index(['shop_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  // --- RLS cleanup ---
  await knex.raw(`
    DROP POLICY IF EXISTS daily_operational_brief_snapshot_tenant_isolation ON daily_operational_brief_snapshot;
  `);
  
  await knex.schema.dropTableIfExists('daily_operational_brief_snapshot');
}