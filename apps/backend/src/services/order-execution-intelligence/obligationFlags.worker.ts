import db from '@lasyncro/backend-core/db.js';

/**
 * Obligation Flag Worker (L2)
 * ---------------------------
 * Writes execution obligation signals onto order_fulfillment_status.
 *
 * Contract:
 * - Reads from inventory_truth only
 * - Never mutates ledger
 * - Never infers fulfillment state
 * - SAFE to rerun (idempotent)
 *
 * Inventory Semantics:
 * - available > 0  → executable (NULL)
 * - available == 0 → stockout
 * - available < 0  → oversell
 */

export async function computeObligationFlags(
  shopId: number
): Promise<void> {
  type InventoryRow = {
    lasyncro_order_id: string;
    total_available: string | number | null;
  };

  // 1️⃣ Aggregate availability per order
  const inventoryRows = await db('order_revenue_units as ru')
    .join('orders as o', 'o.lasyncro_order_id', 'ru.lasyncro_order_id')
    .leftJoin('inventory_truth as it', function () {
      this.on('it.lasyncro_variant_id', '=', 'ru.lasyncro_variant_id')
          .andOn('it.shop_id', '=', 'o.shop_id');
    })
    .where('o.shop_id', shopId)
    .groupBy('ru.lasyncro_order_id')
    .select('ru.lasyncro_order_id')
    .sum({ total_available: 'it.available_quantity' }) as InventoryRow[];

  const stockoutOrders = new Set<string>();
  const oversellOrders = new Set<string>();

  for (const row of inventoryRows) {
    if (row.total_available == null) continue;

    const available = Number(row.total_available);

    if (available === 0) {
      stockoutOrders.add(row.lasyncro_order_id);
    } else if (available < 0) {
      oversellOrders.add(row.lasyncro_order_id);
    }
  }

  // 2️⃣ Write stockout classification
  if (stockoutOrders.size > 0) {
    await db('order_fulfillment_status')
      .whereIn('lasyncro_order_id', Array.from(stockoutOrders))
      .update({
        inventory_block_type: 'stockout',
      });
  }

  // 3️⃣ Write oversell classification
  if (oversellOrders.size > 0) {
    await db('order_fulfillment_status')
      .whereIn('lasyncro_order_id', Array.from(oversellOrders))
      .update({
        inventory_block_type: 'oversell',
      });
  }

  // 4️⃣ Clear executable orders (NULL)
  await db('order_fulfillment_status')
    .whereIn(
      'lasyncro_order_id',
      db('orders')
        .select('lasyncro_order_id')
        .where('shop_id', shopId)
    )
    .whereNotIn(
      'lasyncro_order_id',
      [
        ...stockoutOrders,
        ...oversellOrders,
      ]
    )
    .update({
      inventory_block_type: null,
    });

  // 5️⃣ Freshness mark
  await db('order_fulfillment_status')
    .whereIn(
      'lasyncro_order_id',
      db('orders')
        .select('lasyncro_order_id')
        .where('shop_id', shopId)
    )
    .update({
      obligation_evaluated_at: db.fn.now(),
    });
}
