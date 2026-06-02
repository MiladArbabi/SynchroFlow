import type { Knex } from 'knex';

/**
 * MIGRATION 0112 — WM-34 Invoice Print Infrastructure
 * -----------------------------------------------------
 * Four changes to support order-level invoice generation:
 *
 * 1. Add 'invoice' to barcode_label_type enum
 *    Invoice print jobs are order-level, not variant-level.
 *
 * 2. Add wms_barcode to orders
 *    LSO-{8char} generated at batch release.
 *    Physical identity of the order from warehouse entry to ship.
 *    Scanned on invoice to confirm shipment (replaces manual CTA in WEB-PACK-02).
 *
 * 3. Make barcode_print_jobs.lasyncro_variant_id nullable
 *    Invoice jobs have no variant — they belong to an order.
 *    Existing variant-level jobs (lasyncro, problem) are unaffected.
 *
 * 4. Add lasyncro_order_id FK to barcode_print_jobs
 *    Links invoice print jobs to their source order.
 *    Nullable — variant-level jobs have no order reference.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Add 'invoice' to barcode_label_type enum
  await knex.raw(`
    ALTER TYPE barcode_label_type ADD VALUE IF NOT EXISTS 'invoice';
  `);

  // 2. Add wms_barcode to orders
  await knex.schema.alterTable('orders', (table) => {
    table
      .string('wms_barcode', 20)
      .nullable()
      .unique();
  });

  // 3. Make lasyncro_variant_id nullable on barcode_print_jobs
  await knex.schema.alterTable('barcode_print_jobs', (table) => {
    table.uuid('lasyncro_variant_id').nullable().alter();
  });

  // 4. Add lasyncro_order_id FK to barcode_print_jobs
  await knex.schema.alterTable('barcode_print_jobs', (table) => {
    table
      .uuid('lasyncro_order_id')
      .nullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.index(['lasyncro_order_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('barcode_print_jobs', (table) => {
    table.dropIndex(['lasyncro_order_id']);
    table.dropColumn('lasyncro_order_id');
    table.uuid('lasyncro_variant_id').notNullable().alter();
  });

  await knex.schema.alterTable('orders', (table) => {
    table.dropColumn('wms_barcode');
  });

  // Note: enum values cannot be removed in PostgreSQL without recreating the type.
  // 'invoice' label_type remains in the enum after rollback — harmless.
}