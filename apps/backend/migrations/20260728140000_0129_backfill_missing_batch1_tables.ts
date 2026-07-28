import { Knex } from 'knex';

/**
 * MIGRATION 0129 — backfill_missing_batch1_tables
 * -------------------------------------------------
 * DRIFT-AUDIT-01 forward fix. Three tables — historical_sales,
 * product_costs (both defined in 0056), and user_milestones (defined
 * in 0010) — were added to their respective migration files AFTER
 * those migrations had already run in production (batch 1,
 * 2026-06-18). Knex marked 0010 and 0056 complete and silently
 * skipped the amendments, so none of these three tables were ever
 * created in prod. Same drift pattern as 0048/warehouses (see
 * PROD-ZONE1). Confirmed via schema diff against a from-scratch
 * canonical build, 2026-07-28.
 *
 * Live code paths reference all three tables with no error handling
 * (ProductDependencyFacts/ProductOperationalFacts/
 * ProductDataFreshnessFacts services for historical_sales/
 * product_costs; user-state.service.ts for user_milestones) —
 * these are presumed to be failing in prod wherever they execute.
 *
 * Idempotent: uses hasTable() checks so this is a safe no-op on any
 * environment where 0010/0056 already created these tables correctly
 * (i.e. every fresh install, local dev, CI). Only prod needs the
 * actual creation. (0128 did not do this and broke fresh installs —
 * see its own commit history for the fix-forward note.)
 */
export async function up(knex: Knex): Promise<void> {
  const hasHistoricalSales = await knex.schema.hasTable('historical_sales');
  if (!hasHistoricalSales) {
    await knex.schema.createTable('historical_sales', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.integer('shop_id')
        .notNullable()
        .references('id')
        .inTable('shops')
        .onDelete('CASCADE');
      table.string('sku', 255).notNullable();
      table.date('sale_date').notNullable();
      table.decimal('units_sold', 14, 2).nullable();
      table.decimal('revenue', 14, 2).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.index(['shop_id', 'sale_date'], 'historical_sales_shop_date_idx');
      table.index(['shop_id', 'sku'], 'historical_sales_shop_sku_idx');
    });

    await knex.raw(`ALTER TABLE historical_sales ENABLE ROW LEVEL SECURITY;`);
    await knex.raw(`ALTER TABLE historical_sales FORCE ROW LEVEL SECURITY;`);
    await knex.raw(`
      CREATE POLICY historical_sales_tenant_isolation_policy
      ON historical_sales
      USING (shop_id = current_setting('app.current_tenant')::int);
    `);
  }

  const hasProductCosts = await knex.schema.hasTable('product_costs');
  if (!hasProductCosts) {
    await knex.schema.createTable('product_costs', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.integer('shop_id')
        .notNullable()
        .references('id')
        .inTable('shops')
        .onDelete('CASCADE');
      table.string('sku', 255).notNullable();
      table.decimal('unit_cost', 12, 2).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(['shop_id', 'sku']);
      table.index(['shop_id'], 'product_costs_shop_idx');
    });

    await knex.raw(`ALTER TABLE product_costs ENABLE ROW LEVEL SECURITY;`);
    await knex.raw(`ALTER TABLE product_costs FORCE ROW LEVEL SECURITY;`);
    await knex.raw(`
      CREATE POLICY product_costs_tenant_isolation_policy
      ON product_costs
      USING (shop_id = current_setting('app.current_tenant')::int);
    `);
  }

  const hasUserMilestones = await knex.schema.hasTable('user_milestones');
  if (!hasUserMilestones) {
    await knex.schema.createTable('user_milestones', (table) => {
      table.increments('id').primary();
      table.integer('user_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      table.string('milestone').notNullable();
      table.timestamp('achieved_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(['user_id', 'milestone']);
    });

    await knex.raw(`ALTER TABLE user_milestones ENABLE ROW LEVEL SECURITY;`);
    await knex.raw(`ALTER TABLE user_milestones FORCE ROW LEVEL SECURITY;`);
    await knex.raw(`
      CREATE POLICY user_milestones_tenant_isolation_policy
      ON user_milestones
      USING (
        user_id IN (
          SELECT id FROM users
          WHERE shop_id = current_setting('app.current_tenant')::int
        )
      );
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_milestones');
  await knex.schema.dropTableIfExists('product_costs');
  await knex.schema.dropTableIfExists('historical_sales');
}
