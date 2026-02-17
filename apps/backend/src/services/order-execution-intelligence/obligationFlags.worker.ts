import db from '@lasyncro/backend-core/db.js';

/**
 * Obligation Flag Worker (L2)
 * --------------------------
 * Writes obligation signals onto execution rows.
 *
 * Contract:
 * - Writes ONLY obligation flags
 * - Never infers fulfillment or revenue
 *
 * This worker is SAFE to rerun.
 */

/**
 * SOVEREIGN INVENTORY OBLIGATION ANCHOR (v2)
 * ------------------------------------------
 * - UUID-anchored via lasyncro_order_id
 * - shop_id derived from orders
 * - Inventory join based on SKU only
 */
export async function computeObligationFlags(shopId: number): Promise<void> {

  // 1️⃣ Collect inventory-evaluated revenue units for this shop
  const inventoryRows = await db('order_revenue_units as ru')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ru.lasyncro_order_id'
    )
    .leftJoin(
      'inventory_truth as it',
      'it.sku',
      'ru.sku'
    )
    .where('o.shop_id', shopId)
    .select(
      'ru.lasyncro_order_id',
      'it.quantity_available',
      'it.quantity_reserved',
      'it.quantity_buffer'
    );

  const inventoryBlockedOrders = new Set<string>();

  for (const row of inventoryRows) {
    if (
      row.quantity_available == null ||
      row.quantity_reserved == null ||
      row.quantity_buffer == null
    ) {
      continue;
    }

    const netAvailable =
      row.quantity_available -
      row.quantity_reserved -
      row.quantity_buffer;

    if (netAvailable <= 0) {
      inventoryBlockedOrders.add(row.lasyncro_order_id);
    }
  }

  // 2️⃣ Mark blocked
  await db('order_fulfillment_status as ofs')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .whereIn(
      'ofs.lasyncro_order_id',
      Array.from(inventoryBlockedOrders)
    )
    .update({
      has_inventory_block: true,
    });

  // 3️⃣ Clear non-blocked
  await db('order_fulfillment_status as ofs')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .whereNotIn(
      'ofs.lasyncro_order_id',
      Array.from(inventoryBlockedOrders)
    )
    .update({
      has_inventory_block: false,
    });

  // 4️⃣ Freshness mark
  await db('order_fulfillment_status as ofs')
    .join(
      'orders as o',
      'o.lasyncro_order_id',
      'ofs.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .update({
      obligation_evaluated_at: db.fn.now(),
    });

  return;
}