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
 * 
 *  * ⚠️ DRIFT WARNING (added post DRIFT-AUDIT-01, 2026-07-28)
 * -----------------------------------------------------
 * This migration ran in production on 2026-06-18 (batch 1) BEFORE the
 * historical_sales and product_costs tables were added to this file.
 * Knex marks this migration complete and will NEVER re-run it — so
 * this file's current `up()` does NOT reflect what actually existed
 * in prod for shops/tenants created before 2026-07-28.
 *
 * historical_sales and product_costs were backfilled into production
 * separately via migration 0129
 * (20260728140000_0129_backfill_missing_batch1_tables.ts).
 *
 * DO NOT amend this file's `up()` again expecting it to affect prod.
 * Any further schema change here only affects fresh/local databases
 * migrated from scratch. Use a new forward migration instead (rule 7).
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
    /**
     * SYSTEM INVARIANT (UPSERT SUPPORT)
     * ---------------------------------
     * Required for ON CONFLICT DO UPDATE.
     *
     * Without this:
     * - reconciliation crashes
     * - projections cannot merge deterministically
     */
    table.timestamp('updated_at')
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

  /**
   * TABLE: historical_sales
   * -----------------------
   * SKU-level daily sales history, period-scoped.
   *
   * Consumed by the products-FT2 fact resolvers
   * (ProductOperationalFacts / ProductDependencyFacts /
   *  ProductDataFreshnessFacts) to determine which SKUs have
   * observed sales within a reporting window. Queried by
   * (shop_id, sale_date range, sku) — see those services.
   *
   * Co-located with revenue_projection_daily because both are
   * tenant-scoped, period-derived sales-history projections.
   * Created here (base migration) rather than a patch migration
   * to keep the migration directory clean during development.
   */
  await knex.schema.createTable('historical_sales', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');
    table.string('sku').notNullable();
    table.date('sale_date').notNullable();
    /**
     * Sales magnitude columns — nullable so the table can be
     * populated from multiple upstreams (revenue units, imports)
     * without forcing every writer to supply all metrics.
     */
    table.decimal('units_sold', 14, 2).nullable();
    table.decimal('revenue', 14, 2).nullable();
    table.timestamp('created_at')
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.fn.now());
    table.index(['shop_id', 'sale_date'], 'historical_sales_shop_date_idx');
    table.index(['shop_id', 'sku'], 'historical_sales_shop_sku_idx');
  });
  /**
   * RLS INVARIANT
   * -------------
   * historical_sales is tenant-scoped sales-history data.
   * Same boundary contract as revenue_projection_daily.
   */
  await knex.raw(`
    ALTER TABLE historical_sales ENABLE ROW LEVEL SECURITY;
    ALTER TABLE historical_sales FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`
    DROP POLICY IF EXISTS historical_sales_tenant_isolation_policy ON historical_sales;
  `);
  await knex.raw(`
    CREATE POLICY historical_sales_tenant_isolation_policy
    ON historical_sales
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  /**
   * TABLE: product_costs
   * --------------------
   * SKU-level unit-cost records. Consumed by the products-FT2 fact
   * resolvers (ProductDependencyFacts) which test for the PRESENCE of
   * any cost data per shop (count(*) where shop_id) to compute cost
   * coverage signals. Co-located here as a tenant-scoped cost projection
   * alongside historical_sales; created in this base migration to keep
   * the migration directory clean during development.
   */
  await knex.schema.createTable('product_costs', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');
    table.string('sku').notNullable();
    table.decimal('unit_cost', 12, 2).nullable();
    table.timestamp('created_at')
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.fn.now());
    table.unique(['shop_id', 'sku']);
    table.index(['shop_id'], 'product_costs_shop_idx');
  });
  /**
   * RLS INVARIANT
   * -------------
   * product_costs is tenant-scoped cost data. Same boundary contract
   * as historical_sales / revenue_projection_daily.
   */
  await knex.raw(`
    ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE product_costs FORCE ROW LEVEL SECURITY;
  `);
  await knex.raw(`
    DROP POLICY IF EXISTS product_costs_tenant_isolation_policy ON product_costs;
  `);
  await knex.raw(`
    CREATE POLICY product_costs_tenant_isolation_policy
    ON product_costs
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('product_costs');
  await knex.schema.dropTableIfExists('historical_sales');
  await knex.schema.dropTableIfExists('revenue_projection_daily');
}