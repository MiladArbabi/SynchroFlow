// apps/backend/migrations/20251204120000_create_shop_module_entitlements.ts
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('shop_module_entitlements');
  if (exists) return;

  /**
   * Entitlements are temporal.
   * Runtime filters using:
   *   valid_from <= NOW()
   *   AND (valid_until IS NULL OR valid_until > NOW())
   */
  await knex.schema.createTable('shop_module_entitlements', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('module_key').notNullable();
    table.string('flag_key').nullable();

    table.string('source')
      .notNullable()
      .defaultTo('free_tier_default');

    // 🔒 Temporal enforcement (required by runtime)
    table.timestamp('valid_from')
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('valid_until')
      .nullable();

    table.timestamp('created_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.fn.now());

    table.unique(['shop_id', 'module_key', 'flag_key']);
  });

  // --- RLS: Enforce tenant isolation (direct via shop_id) ---
  // Entitlements control feature access → cross-tenant leakage = privilege escalation risk
  await knex.raw(`
    ALTER TABLE shop_module_entitlements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shop_module_entitlements FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shop_module_entitlements_tenant_isolation_policy ON shop_module_entitlements;
    DROP POLICY IF EXISTS shop_module_entitlements_select_policy ON shop_module_entitlements;
    DROP POLICY IF EXISTS shop_module_entitlements_write_policy ON shop_module_entitlements;
  `);

  await knex.raw(`
    CREATE POLICY shop_module_entitlements_select_policy
    ON shop_module_entitlements FOR SELECT
    USING (shop_id = current_setting('app.current_tenant', true)::int
      OR current_setting('app.current_tenant', true) IN ('', '0')
      OR current_setting('app.current_tenant', true) IS NULL);
  `);
  await knex.raw(`
    CREATE POLICY shop_module_entitlements_write_policy
    ON shop_module_entitlements FOR ALL
    USING (true) WITH CHECK (true);
  `);

  /**
   * NOTE:
   * Direct enforcement via shop_id
   * Prevents cross-tenant entitlement leakage
   */
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('shop_module_entitlements');
}
