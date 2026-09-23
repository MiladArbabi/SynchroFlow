import { Knex } from 'knex';

/**
 * MIGRATION 0194 — create_shopify_opening_inventory_expectations (GH-1145-A1)
 * ----------------------------------------------------------------------------
 * Durable store for the `reconcile_opening_expectation_v2` bootstrap path
 * (shop_wms_settings.bootstrap_model, migration 0193). For a v2 tenant the
 * initial Shopify inventoryQuantity is captured here as an opening
 * EXPECTATION only — never inventory_movements, never inventory_truth, never
 * release capacity. Physical capacity comes only from physical writers
 * (Receive, Recount, WMS).
 *
 * One immutable snapshot row per shop + variant:
 *   reported_quantity — raw signed Shopify inventoryQuantity (may be negative
 *                       when the platform allows overselling).
 *   expected_quantity — GREATEST(0, reported_quantity), computed by
 *                       seedShopifyOpeningBalances.ts. `>= 0` is DB-enforced;
 *                       the derived relationship is application-enforced (no
 *                       cross-column derived CHECK exists in this repo).
 *   external_variant_id — the Shopify variant GID the row was captured from.
 *   observed_at       — one shared timestamp for the whole accepted snapshot;
 *                       the v2 fulfillment temporal baseline.
 *
 * IMMUTABILITY: whole-row append-only, same shape as
 * prevent_inventory_movements_mutation() (migration 0037) — UPDATE and
 * DELETE rejected unconditionally, no bypass flag.
 *
 * RLS: ENABLE + FORCE, direct shop_id policy, mirrors inventory_movements.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('shopify_opening_inventory_expectations', (table) => {
    table.increments('id').primary();

    table
      .integer('shop_id')
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table
      .uuid('lasyncro_variant_id')
      .notNullable()
      .references('lasyncro_variant_id')
      .inTable('variants')
      .onDelete('CASCADE');

    table.text('external_variant_id').notNullable();

    table.integer('reported_quantity').notNullable();
    table.integer('expected_quantity').notNullable();

    table.timestamp('observed_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(
      ['shop_id', 'lasyncro_variant_id'],
      'shopify_opening_inventory_expectations_shop_variant_unique'
    );

    table.index(['shop_id'], 'shopify_opening_inventory_expectations_shop_id_index');
  });

  await knex.schema.raw(`
    ALTER TABLE shopify_opening_inventory_expectations
    ADD CONSTRAINT shopify_opening_inventory_expectations_expected_quantity_check
    CHECK (expected_quantity >= 0);
  `);

  await knex.schema.raw(`
    CREATE OR REPLACE FUNCTION prevent_shopify_opening_inventory_expectations_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'shopify_opening_inventory_expectations is append-only. % is not allowed.', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER shopify_opening_inventory_expectations_no_update
    BEFORE UPDATE ON shopify_opening_inventory_expectations
    FOR EACH ROW
    EXECUTE FUNCTION prevent_shopify_opening_inventory_expectations_mutation();

    CREATE TRIGGER shopify_opening_inventory_expectations_no_delete
    BEFORE DELETE ON shopify_opening_inventory_expectations
    FOR EACH ROW
    EXECUTE FUNCTION prevent_shopify_opening_inventory_expectations_mutation();
  `);

  await knex.raw(`
    ALTER TABLE shopify_opening_inventory_expectations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE shopify_opening_inventory_expectations FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS shopify_opening_inventory_expectations_tenant_isolation_policy
    ON shopify_opening_inventory_expectations;
  `);

  await knex.raw(`
    CREATE POLICY shopify_opening_inventory_expectations_tenant_isolation_policy
    ON shopify_opening_inventory_expectations
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw(`
    DROP TRIGGER IF EXISTS shopify_opening_inventory_expectations_no_update ON shopify_opening_inventory_expectations;
    DROP TRIGGER IF EXISTS shopify_opening_inventory_expectations_no_delete ON shopify_opening_inventory_expectations;
    DROP FUNCTION IF EXISTS prevent_shopify_opening_inventory_expectations_mutation();
  `);

  await knex.schema.dropTableIfExists('shopify_opening_inventory_expectations');
}
