import { Knex } from 'knex';

/**
 * MIGRATION 0135 — fix_shop_module_entitlements_write_policy
 * -----------------------------------------------------------
 * OV-29-A: shop_module_entitlements_write_policy was FOR ALL USING (true).
 *
 * PostgreSQL OR's all applicable policies per command — a FOR ALL USING (true)
 * policy applies to SELECT as well as writes, overriding the scoped SELECT
 * policy and making all 21 entitlement rows visible to any connection at
 * any tenant value, including the database default '0'. Entitlements gate
 * tier access; this is a data-isolation defect for a table that determines
 * what features merchants can access.
 *
 * The fix tightens the write policy to the same shop_id constraint the SELECT
 * policy already uses. All existing write call sites use withTenant() (0
 * unwrapped writes confirmed via audit), so no pre-tenant write access is lost.
 *
 * Base migration 0022 also amended — fresh installs are correct; this forward
 * migration converges existing databases. Same pattern as 0131 (commands/DEQ).
 *
 * Idempotent: DROP POLICY IF EXISTS before CREATE POLICY.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP POLICY IF EXISTS shop_module_entitlements_write_policy ON shop_module_entitlements;
  `);
  await knex.raw(`
    CREATE POLICY shop_module_entitlements_write_policy
    ON shop_module_entitlements FOR ALL
    USING (shop_id = current_setting('app.current_tenant', true)::int)
    WITH CHECK (shop_id = current_setting('app.current_tenant', true)::int);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP POLICY IF EXISTS shop_module_entitlements_write_policy ON shop_module_entitlements;
  `);
  await knex.raw(`
    CREATE POLICY shop_module_entitlements_write_policy
    ON shop_module_entitlements FOR ALL
    USING (true) WITH CHECK (true);
  `);
}