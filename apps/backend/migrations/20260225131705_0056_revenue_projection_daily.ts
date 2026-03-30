import { Knex } from 'knex';

/**
 * SNAPSHOT: revenue_projection_daily
 * -----------------------------------
 * Pre-aggregated daily structural revenue.
 *
 * Derived from:
 * - order_revenue_units_net
 * - orders.order_created_at
 *
 * Replace-per-day-per-shop.
 */

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('revenue_projection_daily', (table) => {
    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.date('revenue_date').notNullable();

    table.decimal('gross_revenue', 14, 2).notNullable();
    table.decimal('order_count', 12, 0).notNullable();
    table.decimal('at_risk_revenue', 14, 2).notNullable();

    table.timestamp('evaluated_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['shop_id', 'revenue_date']);
  });

  /**
   * RLS INVARIANT
   * -------------
   * revenue_projection_daily is tenant-scoped financial projection data.
   *
   * Contains:
   * - daily revenue projections
   * - trend and forecast signals
   *
   * Cross-tenant access exposes sensitive business performance data.
   *
   * shop_id is the authoritative tenant boundary.
   * No relational enforcement allowed.
   */
  // --- RLS: Enforce tenant isolation ---
  await knex.raw(`
    ALTER TABLE revenue_projection_daily ENABLE ROW LEVEL SECURITY;
    ALTER TABLE revenue_projection_daily FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS revenue_projection_daily_tenant_isolation_policy ON revenue_projection_daily;
  `);

  await knex.raw(`
    CREATE POLICY revenue_projection_daily_tenant_isolation_policy
    ON revenue_projection_daily
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  await knex.schema.alterTable('revenue_projection_daily', (table) => {
    table.index(['shop_id', 'revenue_date'], 'rpd_shop_date_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('revenue_projection_daily');
}