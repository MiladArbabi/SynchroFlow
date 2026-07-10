// apps/backend/migrations/20260710140801_0122_create_supplier_product_preferences.ts
//
// Creates supplier_product_preferences — the preference layer for supplier-product
// assignment. Full design in sourcing-recommendation-playbook.md §7.
//
// RLS: tenant-isolated on shop_id. Every read/write must SET LOCAL app.current_tenant.
// Scope types: 'variant' | 'product' | 'product_type' — most specific wins.
// Resolution order enforced in backend (sourcingRecommendations.controller.ts),
// not in DB — see playbook §7.3.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('supplier_product_preferences', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    t.integer('shop_id')
      .notNullable()
      .references('id').inTable('shops')
      .onDelete('CASCADE');

    t.integer('supplier_id')
      .notNullable()
      .references('id').inTable('suppliers')
      .onDelete('CASCADE');

    // Scope — most specific wins: variant > product > product_type
    t.text('scope_type')
      .notNullable()
      .checkIn(['variant', 'product', 'product_type']);

    // scope_id: lasyncro_variant_id, lasyncro_product_id, or product_type string
    t.text('scope_id').notNullable();

    // 1 = primary, 2 = backup. Lower wins within same scope+supplier.
    t.smallint('priority').notNullable().defaultTo(1);

    // Merchant's free-text reasoning. No structured conditions in v1.
    t.text('note').nullable();

    t.integer('created_by')
      .nullable()
      .references('id').inTable('users')
      .onDelete('SET NULL');

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // One preference row per supplier+scope combination per shop.
    t.unique(['shop_id', 'scope_type', 'scope_id', 'supplier_id']);
  });

  // RLS: tenant isolation
  await knex.raw(`
    ALTER TABLE supplier_product_preferences ENABLE ROW LEVEL SECURITY;
    CREATE POLICY supplier_product_preferences_tenant_isolation
      ON supplier_product_preferences
      USING (shop_id = (current_setting('app.current_tenant'))::integer);
  `);

  // Indexes for common query patterns
  await knex.raw(`
    CREATE INDEX supplier_product_preferences_shop_scope_idx
      ON supplier_product_preferences (shop_id, scope_type, scope_id);
    CREATE INDEX supplier_product_preferences_supplier_idx
      ON supplier_product_preferences (shop_id, supplier_id);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('supplier_product_preferences');
}