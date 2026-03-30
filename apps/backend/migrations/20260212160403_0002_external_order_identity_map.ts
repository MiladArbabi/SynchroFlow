import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('external_order_identity_map', (table) => {
    table.increments('id').primary();

    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.integer('shop_id')
      .unsigned()
      .notNullable()
      .references('id')
      .inTable('shops')
      .onDelete('CASCADE');

    table.string('platform').notNullable(); // shopify, amazon, woocommerce, etc.
    table.string('external_order_id').notNullable();

    /**
     * CANONICAL NUMERIC ENFORCEMENT
     * -----------------------------
     * External order identity must be numeric string only.
     * Prevents GID format drift at schema level.
     */
    table.check(
      "external_order_id ~ '^[0-9]+$'",
      [],
      'external_order_id_numeric_check'
    );

    table.timestamps(true, true);

    table.unique(['shop_id', 'platform', 'external_order_id']);
    table.index(['lasyncro_order_id']);
  });

  // --- RLS: Enforce tenant isolation (via orders) ---
  // No direct shop_id → enforce through orders relation
  await knex.raw(`
    ALTER TABLE external_order_identity_map ENABLE ROW LEVEL SECURITY;
    ALTER TABLE external_order_identity_map FORCE ROW LEVEL SECURITY;
  `);

  await knex.raw(`
    DROP POLICY IF EXISTS external_order_identity_map_tenant_isolation_policy ON external_order_identity_map;
  `);


  /*-- 🔒 Direct tenant enforcement (authoritative)
  -- shop_id is present → MUST be used instead of relational inference */
  await knex.raw(`
    CREATE POLICY external_order_identity_map_tenant_isolation_policy
    ON external_order_identity_map
    USING (
      shop_id = current_setting('app.current_tenant')::int
    );
  `);

  /**
   * NOTE:
   * shop_id exists and is NOT NULL → direct enforcement is authoritative
   * Guarantees tenant isolation through canonical order ownership
   */
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('external_order_identity_map');
}