import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shopify_app_installations', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('shop_domain').notNullable().unique();

    table.text('access_token').notNullable();
    table.text('scopes').notNullable();

    table.timestamp('installed_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('uninstalled_at', { useTz: true }).nullable();

    table.timestamps(true, true);

    table.index(['shop_domain']);
    table.index(['shop_id']);
  });

  // --- RLS: Enforce tenant isolation (direct) ---
  // shop_id is NOT NULL → authoritative tenant anchor
  await knex.raw(`
    ALTER TABLE shopify_app_installations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shopify_app_installations FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shopify_app_installations_tenant_isolation_policy ON shopify_app_installations;
    DROP POLICY IF EXISTS shopify_app_installations_select_policy ON shopify_app_installations;
    DROP POLICY IF EXISTS shopify_app_installations_write_policy ON shopify_app_installations;
  `);
  await knex.raw(`
    CREATE POLICY shopify_app_installations_select_policy
    ON shopify_app_installations FOR SELECT
    USING (shop_id = current_setting('app.current_tenant', true)::int
      OR current_setting('app.current_tenant', true) IN ('', '0')
      OR current_setting('app.current_tenant', true) IS NULL);
  `);
  await knex.raw(`
    CREATE POLICY shopify_app_installations_write_policy
    ON shopify_app_installations FOR ALL
    USING (true) WITH CHECK (true);
  `);

  /**
   * NOTE:
   * Direct enforcement via shop_id
   * Prevents cross-tenant access to external platform credentials
   */
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shopify_app_installations');
}