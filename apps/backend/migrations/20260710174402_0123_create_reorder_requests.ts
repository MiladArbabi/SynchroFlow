// File: apps/backend/migrations/20260710173001_0123_create_reorder_requests.ts

import type { Knex } from 'knex';

// §8 MOQ Accumulation System — sourcing-recommendation-playbook.md §8
// Stores pending reorder requests before they are converted to a PO.
// Supplier is locked at queue time — never re-resolved on convert.
// See §8.3 for full schema rationale.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('reorder_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.integer('shop_id').notNullable().references('id').inTable('shops').onDelete('CASCADE');

    // Variant being requested — uuid matches variants.lasyncro_variant_id type
    t.uuid('lasyncro_variant_id').notNullable();

    // Supplier locked at queue time — §8.1, never re-resolved
    t.integer('supplier_id').notNullable().references('id').inTable('suppliers').onDelete('CASCADE');

    t.integer('qty_requested').notNullable();

    // 'alert' = originated from stockout_risk deep-link
    // 'manual' = merchant queued directly from Sourcing page
    t.text('source').notNullable().checkIn(['alert', 'manual'], 'reorder_requests_source_check');

    // pending → converted (PO created) or dismissed (removed without PO)
    t.text('status').notNullable().defaultTo('pending')
      .checkIn(['pending', 'converted', 'dismissed'], 'reorder_requests_status_check');

    // Populated on convert — text to avoid FK type coupling to purchase_orders.id
    t.text('converted_po_id').nullable();
    t.timestamp('converted_at', { useTz: true }).nullable();

    t.integer('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Primary query: all pending for a shop grouped by supplier (GET /reorder-requests)
  await knex.schema.raw(`
    CREATE INDEX reorder_requests_shop_supplier_status_idx
      ON reorder_requests (shop_id, supplier_id, status)
  `);

  // Secondary: check existing pending per variant (duplicate-awareness in POST)
  await knex.schema.raw(`
    CREATE INDEX reorder_requests_shop_variant_status_idx
      ON reorder_requests (shop_id, lasyncro_variant_id, status)
  `);

  // RLS: tenant isolation — same pattern as supplier_product_preferences
  await knex.schema.raw(`
    ALTER TABLE reorder_requests ENABLE ROW LEVEL SECURITY
  `);
  await knex.schema.raw(`
    CREATE POLICY reorder_requests_tenant_isolation
      ON reorder_requests
      USING (shop_id = current_setting('app.current_tenant')::integer)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP POLICY IF EXISTS reorder_requests_tenant_isolation ON reorder_requests');
  await knex.schema.dropTableIfExists('reorder_requests');
}