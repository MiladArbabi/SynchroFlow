import type { Knex } from 'knex';

/**
 * CONSTRAINT METRICS
 * ------------------
 * Handles blocked revenue + constrained orders.
 *
 * ISS-055 (2026-07-09): `customer`-type constraints always have
 * target_id = NULL — they are order-level, exactly like `operational`
 * constraints, NOT variant-level like `inventory` constraints. The
 * original query joined ALL constraint types (inventory + customer)
 * against order_revenue_units_net on `oc.target_id = runet.lasyncro_variant_id`.
 * For customer constraints that condition can never match (target_id is
 * always null), so `revenueBlockedCustomer` silently computed to 0 for
 * every shop, every snapshot — while the order set (`constrainedOrders`)
 * was still correct, since that count doesn't depend on target_id at all.
 * This is why Overview/Orders/Order Flow showed matching order counts (15)
 * but wildly different dollar totals ($8,977 / $0 / $22,294.05) for the
 * same constraint set.
 *
 * Fix: `customer` now uses the same order-level join + SUM(o.total_price)
 * pattern as `operational`. `inventory` keeps the variant-level join,
 * since inventory constraints DO populate target_id with a real
 * lasyncro_variant_id.
 */
export async function computeConstraintMetrics(
  trx: Knex.Transaction,
  shopId: string,
  snapshotCutoff: Date
) {
  /**
   * SAFE ACCESS: enforce DB row contracts for constraint metrics
   */
  type CountRow = { count: number | string | null };

  function requireRow<T>(row: T | undefined, label: string): T {
    if (!row) {
      throw new Error(`[constraint.metrics] Missing ${label} — DB contract violation`);
    }
    return row;
  }

  // --- Inventory blocked revenue ---
  // Inventory constraints are variant-level (target_id = lasyncro_variant_id).
  // Join through revenue units to get revenue per blocked variant.
  const inventoryBlockedRow = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .join('order_constraints as oc', (join) => {
      join.on('oc.lasyncro_order_id', '=', 'runet.lasyncro_order_id')
        .andOn('oc.target_id', '=', 'runet.lasyncro_variant_id')
        .andOnVal('oc.constraint_type', 'inventory')
        .andOnVal('oc.is_active', true);
    })
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .sum('runet.net_revenue as inventory_blocked')
    .first();

  const revenueBlockedInventory = Number(
    (inventoryBlockedRow as { inventory_blocked: number | string | null } | undefined)
      ?.inventory_blocked ?? 0
  );

  // --- Customer blocked revenue ---
  // ISS-055: customer constraints are order-level (target_id is always
  // NULL for this type) — same shape as operational below, NOT the
  // variant-level join used for inventory above.
  const customerBlockedRow = await trx('orders as o')
    .join('order_constraints as oc', (join) => {
      join.on('oc.lasyncro_order_id', '=', 'o.lasyncro_order_id')
        .andOnVal('oc.constraint_type', 'customer')
        .andOnVal('oc.is_active', true);
    })
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .sum('o.total_price as customer_blocked')
    .first();

  const revenueBlockedCustomer = Number(
    (customerBlockedRow as { customer_blocked: number | string | null } | undefined)
      ?.customer_blocked ?? 0
  );

  // --- Operational blocked revenue ---
  // Operational constraints are order-level (target_id = NULL).
  // Sum total_price directly from orders — not via revenue units.
  const operationalBlockedRow = await trx('orders as o')
    .join('order_constraints as oc', (join) => {
      join.on('oc.lasyncro_order_id', '=', 'o.lasyncro_order_id')
        .andOnVal('oc.constraint_type', 'operational')
        .andOnVal('oc.is_active', true);
    })
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .sum('o.total_price as operational_blocked')
    .first();

  const revenueBlockedOperational = Number(
    (operationalBlockedRow as { operational_blocked: number | string | null } | undefined)
      ?.operational_blocked ?? 0
  );

  const blockedRevenueTotal =
    revenueBlockedInventory +
    revenueBlockedCustomer +
    revenueBlockedOperational;

  /**
   * CRITICAL: derive constrained orders at ORDER level
   * Prevents duplication from multiple constraint rows per order
   */
  const constrainedOrdersRow = await trx('orders as o')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .whereExists(
      trx('order_constraints as oc')
        .select(1)
        .whereRaw('oc.lasyncro_order_id = o.lasyncro_order_id')
        .andWhere('oc.is_active', true)
    )
    .count('o.lasyncro_order_id as count')
    .first();

  const constrainedOrders = Number(
    requireRow(constrainedOrdersRow as CountRow | undefined, 'constrainedOrdersRow').count ?? 0
  );

  return {
    revenueBlockedInventory,
    revenueBlockedCustomer,
    revenueBlockedOperational,
    blockedRevenueTotal,
    constrainedOrders,
  };
}