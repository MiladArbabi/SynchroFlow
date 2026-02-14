// apps/backend/src/workers/reconciliation/revenue-units.writer.ts

import db from 'api-src/db';

/**
 * Revenue Unit Writer (Variant-Atomic Version)
 * --------------------------------------------
 * - Source: order_line_items
 * - Atomic identity: lasyncro_variant_id
 * - Product is analytical grouping only
 *
 * Guarantees:
 * - Variant-level economic fidelity
 * - No product-level collapse
 * - Idempotent on (lasyncro_order_id, lasyncro_variant_id)
 */

export async function writeOrderRevenueUnits(
  lasyncroOrderId: string
) {
  await db.transaction(async (trx) => {

    const order = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select(['order_processed_at', 'order_created_at', 'platform'])
      .first();

    if (!order) {
      throw new Error(`[RevenueUnitWriter] Order not found: ${lasyncroOrderId}`);
    }

    const occurredAt =
      order.order_processed_at ?? order.order_created_at;

    const rows = await trx('order_line_items')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select(
        'lasyncro_product_id',
        'lasyncro_variant_id',
        'sku',
        'title',
        'quantity',
        'unit_price',
        'line_total',
        'estimated_unit_cost'
      );

    if (rows.length === 0) return;

    const invalid = rows.filter(r => !r.lasyncro_variant_id);
    if (invalid.length > 0) {
      throw new Error(
        `[RevenueUnitWriter] Missing lasyncro_variant_id for order ${lasyncroOrderId}`
      );
    }

    const revenueUnits = rows.map((r) => ({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      lasyncro_product_id: r.lasyncro_product_id,
      lasyncro_variant_id: r.lasyncro_variant_id,
      sku: r.sku,
      title: r.title,
      quantity: r.quantity,
      unit_price: r.unit_price,
      line_total: r.line_total,
      estimated_unit_cost: r.estimated_unit_cost ?? null,
    }));

    await trx('order_revenue_units')
      .insert(revenueUnits)
      .onConflict(['lasyncro_order_id', 'lasyncro_variant_id'])
      .ignore();

    // 🔥 SALE → INVENTORY LEDGER
    await trx('inventory_movements')
      .insert(
        revenueUnits.map((ru) => ({
          lasyncro_inventory_movement_id: crypto.randomUUID(),
          lasyncro_variant_id: ru.lasyncro_variant_id,
          movement_type: 'sale',
          quantity_delta: -ru.quantity,
          reference_type: 'order_revenue_unit',
          reference_id: ru.lasyncro_revenue_unit_id,
          platform: order.platform ?? null,
          occurred_at: occurredAt,
        }))
      )
      .onConflict(['reference_type', 'reference_id', 'lasyncro_variant_id'])
      .ignore();
  });
}

