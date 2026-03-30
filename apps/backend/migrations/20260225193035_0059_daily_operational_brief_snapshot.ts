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