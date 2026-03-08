/**
 * IMMUTABLE REVENUE UNIT MODEL (v2)
 * ---------------------------------
 * Revenue units are structural economic atoms.
 * Refund quantities are derived from refund_execution_line_items.
 *
 * returned_quantity column removed.
 */

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('order_revenue_units', (table) => {
    // Sovereign identity
    table
      .uuid('lasyncro_revenue_unit_id')
      .primary()

    // Ownership
    table.uuid('lasyncro_order_id')
      .notNullable()
      .references('lasyncro_order_id')
      .inTable('orders')
      .onDelete('CASCADE');

    table.uuid('lasyncro_product_id')
      .notNullable()
      .references('lasyncro_product_id')
      .inTable('products')
      .onDelete('RESTRICT');

    // Snapshot identity (do NOT rely only on product table)
    table.string('sku', 255).nullable();
    table.string('title', 255).notNullable();

    // Financial primitives (immutable)
    table.integer('quantity').notNullable();
    table.decimal('unit_price', 12, 2).notNullable();
    table.decimal('line_total', 14, 2).notNullable();

    /**
     * ECONOMIC COST SNAPSHOT
     * ----------------------
     * Cost must be captured for every revenue unit.
     *
     * Allowing NULL creates incomplete economic facts
     * and breaks deterministic margin projections.
     *
     * Invariant:
     * Every revenue unit must carry a historical cost.
     */
    table.decimal('estimated_unit_cost', 12, 2).notNullable();

    /**
     * MARGIN DEPTH EXTENSION
     * ----------------------
     * Immutable economic cost dimensions.
     * Required for structurally correct margin modeling.
     */
    table.decimal('discount_amount', 12, 2).notNullable().defaultTo(0);
    table.decimal('shipping_cost', 12, 2).notNullable().defaultTo(0);
    table.decimal('payment_fee', 12, 2).notNullable().defaultTo(0);
    table.decimal('fulfillment_cost', 12, 2).notNullable().defaultTo(0);

    table.timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Indexes
    table.index(['lasyncro_order_id']);
    table.index(['lasyncro_product_id']);
    table.index(['sku']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('order_revenue_units');
}