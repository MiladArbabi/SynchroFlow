// apps/backend/src/workers/reconciliation/revenue-units.writer.ts

import db from '@lasyncro/backend-core/db.js';
import { v5 as uuidv5 } from 'uuid';

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

const REVENUE_UNIT_NAMESPACE =
  '5f8b7f2e-5e3d-4a55-9f4b-3f7c6d8b91aa'; // fixed constant namespace

export async function writeOrderRevenueUnits(
  lasyncroOrderId: string
) {
  await db.transaction(async (trx) => {

    const order = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select([
        'order_processed_at',
        'order_created_at',
        'shop_id',
      ])
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
      lasyncro_revenue_unit_id: uuidv5(
        `${lasyncroOrderId}:${r.lasyncro_variant_id}`,
        REVENUE_UNIT_NAMESPACE
      ),
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

    /**
     * ECONOMIC IMMUTABILITY RULE
     * --------------------------
     * Revenue units are economic facts derived from order_line_items.
     *
     * They must be INSERT-ONLY.
     * They must NEVER be mutated once materialized.
     *
     * If upstream order data changes in the future,
     * we introduce compensating ledger events — not row mutation.
     *
     * This preserves:
     * - Ledger symmetry
     * - Deterministic replay safety
     * - Economic audit integrity
     *
     * On conflict → ignore.
     */
    await trx('order_revenue_units')
      .insert(revenueUnits)
      .onConflict(['lasyncro_order_id', 'lasyncro_variant_id'])
      .ignore();

    await trx('inventory_movements')
      .insert(
        revenueUnits.map((ru) => ({
          lasyncro_inventory_movement_id: crypto.randomUUID(),
          device_event_id: uuidv5(
            `${ru.lasyncro_revenue_unit_id}:sale`,
            REVENUE_UNIT_NAMESPACE
          ),
          shop_id: order.shop_id,
          lasyncro_variant_id: ru.lasyncro_variant_id,
          movement_type: 'sale',
          quantity_delta: -ru.quantity,
          reference_type: 'order_revenue_unit',
          reference_id: ru.lasyncro_revenue_unit_id,
          platform: null,
          location_code: `WH-${order.shop_id}-ROOT`,
          occurred_at: occurredAt,
        }))
      )
      .onConflict(['device_event_id'])
      .ignore();
  });
}

