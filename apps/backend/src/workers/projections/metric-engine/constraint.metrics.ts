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
  // DC-01b (2026-08-15): whereExists, not join. A join emits one row per
  // matching constraint, so an order carrying two active customer constraints
  // had its total_price summed twice. Existence is the question being asked —
  // "is this order blocked for a customer reason" — not "how many times".
  const customerBlockedRow = await trx('orders as o')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .whereExists(
      trx('order_constraints as oc')
        .select(1)
        .whereRaw('oc.lasyncro_order_id = o.lasyncro_order_id')
        .andWhere('oc.constraint_type', 'customer')
        .andWhere('oc.is_active', true)
    )
    .sum('o.total_price as customer_blocked')
    .first();

  const revenueBlockedCustomer = Number(
    (customerBlockedRow as { customer_blocked: number | string | null } | undefined)
      ?.customer_blocked ?? 0
  );

  // --- Operational blocked revenue ---
  // Operational constraints are order-level (target_id = NULL).
  // Sum total_price directly from orders — not via revenue units.
  // DC-01b: same duplication risk as customer above — one row per constraint.
  const operationalBlockedRow = await trx('orders as o')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .whereExists(
      trx('order_constraints as oc')
        .select(1)
        .whereRaw('oc.lasyncro_order_id = o.lasyncro_order_id')
        .andWhere('oc.constraint_type', 'operational')
        .andWhere('oc.is_active', true)
    )
    .sum('o.total_price as operational_blocked')
    .first();

  const revenueBlockedOperational = Number(
    (operationalBlockedRow as { operational_blocked: number | string | null } | undefined)
      ?.operational_blocked ?? 0
  );

  /**
   * DC-01 (2026-08-15): the total is derived at ORDER level, not by adding the
   * three categories. The categories are overlapping sets by construction — an
   * order blocked on both stock and address appears in inventory AND customer —
   * so their sum double-counts every multi-blocked order. On shop 15 that read
   * $22,195.95 against a true $16,172.20, a 37% overstate on a figure the
   * merchant sees as "revenue at stake".
   *
   * Each category remains correct in isolation and is left untouched; they
   * answer "how much revenue does this cause touch", which legitimately
   * overlaps. Only their sum was invalid.
   *
   * Basis is o.total_price: a blocked order cannot ship, so the whole order's
   * revenue is held. This deliberately differs from revenueBlockedInventory's
   * variant-scoped net_revenue, and makes the total agree with Order Flow's
   * per-order sum, which was already correct.
   *
   * Mirrors the constrainedOrders derivation below — same shape, same reason.
   */
  const blockedRevenueTotalRow = await trx('orders as o')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .whereExists(
      trx('order_constraints as oc')
        .select(1)
        .whereRaw('oc.lasyncro_order_id = o.lasyncro_order_id')
        .andWhere('oc.is_active', true)
    )
    .sum('o.total_price as blocked_total')
    .first();

  const blockedRevenueTotal = Number(
    (blockedRevenueTotalRow as { blocked_total: number | string | null } | undefined)
      ?.blocked_total ?? 0
  );

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