// apps/backend/src/workers/reconciliation/revenue-units.writer.ts

import db from 'api-src/db';

/**
 * Revenue Unit Writer (Sovereign UUID Version)
 * --------------------------------------------
 * - Source: order_line_items
 * - Identity: lasyncro_order_id
 * - No canonical identity
 * - No shop_id usage
 *
 * Guarantees:
 * - Uses platform-reported unit_price
 * - No derived pricing
 * - Idempotent on (lasyncro_order_id, lasyncro_product_id)
 */

export async function writeOrderRevenueUnits(
  lasyncroOrderId: string
) {
  // 1. Fetch sovereign line items
  const rows = await db('order_line_items')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .select(
      'lasyncro_product_id',
      'sku',
      'title',
      'quantity',
      'unit_price',
      'line_total',
      'estimated_unit_cost'
    );

  if (rows.length === 0) return;

  // 2. Insert factual revenue units
  await db('order_revenue_units')
    .insert(
      rows.map((r) => ({
        lasyncro_revenue_unit_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        lasyncro_product_id: r.lasyncro_product_id,
        sku: r.sku,
        title: r.title,
        quantity: r.quantity,
        unit_price: r.unit_price,
        line_total: r.line_total,
        estimated_unit_cost: r.estimated_unit_cost ?? null,
      }))
    )
    .onConflict(['lasyncro_order_id', 'lasyncro_product_id'])
    .ignore();
}
