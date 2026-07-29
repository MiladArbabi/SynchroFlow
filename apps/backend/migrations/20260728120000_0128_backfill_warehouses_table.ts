// apps/backend/migrations/20260728120000_0128_backfill_warehouses_table.ts
import { Knex } from 'knex';

/**
 * MIGRATION 0128 — backfill_warehouses_table
 * -------------------------------------------
 * PROD-ZONE1 forward fix. Migration 0048 was amended after it had already
 * run in production (batch 1, 2026-06-18) to add the `warehouses` table.
 * Knex marked 0048 complete and silently skipped the amendment — the table
 * was never created in prod. This broke zone creation AND shop bootstrap
 * (auth signup + Shopify install), both of which insert into `warehouses`
 * unconditionally. See PROD-ZONE1 / rule-7 discussion.
 *
 * This migration creates `warehouses`, backfills one row per existing shop
 * from that shop's current type='warehouse' root zone, adds warehouse_id
 * to warehouse_locations, backfills it, then enforces NOT NULL + FK.
 */
export async function up(knex: Knex): Promise<void> {
  // OV-33: all DDL — table, index, RLS, column, FK — is wrapped in a single
  // existence check. If `warehouses` already exists, every downstream object
  // (index, policy, warehouse_id column, FK) was created in the same pass and
  // is also present. Re-running migrate on such a DB must be a no-op.
  const exists = await knex.schema.hasTable('warehouses');
  if (!exists) {
    // 1. Create warehouses table
    await knex.schema.createTable('warehouses', (table) => {
      table
        .uuid('warehouse_id')
        .primary()
        .notNullable()
        .defaultTo(knex.raw('gen_random_uuid()'));

      table
        .integer('shop_id')
        .notNullable()
        .references('id')
        .inTable('shops')
        .onDelete('CASCADE');

      table.string('name', 255).notNullable();
      table.string('root_location_code', 255).notNullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.boolean('active').notNullable().defaultTo(true);

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.unique(['shop_id', 'name'], 'warehouses_shop_name_unique');
      table.unique(['shop_id', 'root_location_code'], 'warehouses_shop_root_unique');
      table.index(['shop_id', 'active'], 'warehouses_shop_active_idx');
    });

    await knex.raw(`
      CREATE UNIQUE INDEX warehouses_one_default_per_shop_idx
      ON warehouses (shop_id)
      WHERE is_default = true;
    `);

    await knex.raw(`ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;`);
    await knex.raw(`ALTER TABLE warehouses FORCE ROW LEVEL SECURITY;`);
    await knex.raw(`
      DROP POLICY IF EXISTS warehouses_tenant_isolation_policy ON warehouses;
      CREATE POLICY warehouses_tenant_isolation_policy
      ON warehouses
      USING (shop_id = current_setting('app.current_tenant')::int)
      WITH CHECK (shop_id = current_setting('app.current_tenant')::int);
    `);

    // 2. Backfill: one warehouses row per existing shop from its current
    // type='warehouse' root zone. ON CONFLICT DO NOTHING makes this safe
    // if the row was already inserted by a prior partial run.
    await knex.raw(`
      INSERT INTO warehouses (shop_id, name, root_location_code, is_default, active)
      SELECT DISTINCT ON (shop_id)
        shop_id,
        'Main warehouse',
        location_code,
        true,
        true
      FROM warehouse_locations
      WHERE type = 'warehouse' AND parent_location_code IS NULL
      ORDER BY shop_id, created_at ASC
      ON CONFLICT DO NOTHING;
    `);

    // 3. Add warehouse_id to warehouse_locations (nullable first, for backfill)
    await knex.schema.alterTable('warehouse_locations', (table) => {
      table.uuid('warehouse_id').nullable();
    });

    // 4. Backfill warehouse_id for every existing row from its shop's warehouse
    await knex.raw(`
      UPDATE warehouse_locations wl
      SET warehouse_id = w.warehouse_id
      FROM warehouses w
      WHERE wl.shop_id = w.shop_id;
    `);

    // 5. Enforce NOT NULL + FK now that backfill is complete
    await knex.schema.alterTable('warehouse_locations', (table) => {
      table.uuid('warehouse_id').notNullable().alter();
    });

    await knex.schema.alterTable('warehouse_locations', (table) => {
      table
        .foreign('warehouse_id', 'warehouse_locations_warehouse_id_foreign')
        .references('warehouse_id')
        .inTable('warehouses')
        .onDelete('RESTRICT');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.dropForeign('warehouse_id', 'warehouse_locations_warehouse_id_foreign');
  });
  await knex.schema.alterTable('warehouse_locations', (table) => {
    table.dropColumn('warehouse_id');
  });
  await knex.schema.dropTableIfExists('warehouses');
}