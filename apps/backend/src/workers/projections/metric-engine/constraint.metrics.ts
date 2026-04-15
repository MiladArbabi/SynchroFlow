import type { Knex } from 'knex';

/**
 * CONSTRAINT METRICS
 * ------------------
 * Handles blocked revenue + constrained orders.
 */
export async function computeConstraintMetrics(
  trx: Knex.Transaction,
  shopId: string,
  snapshotCutoff: Date
) {

  /**
   * SAFE ACCESS: enforce DB row contracts for constraint metrics
   */
  type BlockedRevenueRow = {
    inventory_blocked: number | string | null;
    customer_blocked: number | string | null;
    operational_blocked: number | string | null;
  };

  type CountRow = { count: number | string | null };

  function requireRow<T>(row: T | undefined, label: string): T {
    if (!row) {
      throw new Error(`[constraint.metrics] Missing ${label} — DB contract violation`);
    }
    return row;
  }

  // --- Inventory + customer blocked revenue ---
  // These constraints are variant-level (target_id = lasyncro_variant_id).
  // Join through revenue units to get revenue per blocked variant.
  const variantBlockedRevenueRows = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .join('order_constraints as oc', (join) => {
      join.on('oc.lasyncro_order_id', '=', 'runet.lasyncro_order_id')
        .andOn('oc.target_id', '=', 'runet.lasyncro_variant_id')
        .andOn('oc.is_active', '=', trx.client.raw('?', [true]));
    })
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .select([
      trx.raw("SUM(CASE WHEN oc.constraint_type = 'inventory' THEN runet.net_revenue ELSE 0 END) as inventory_blocked"),
      trx.raw("SUM(CASE WHEN oc.constraint_type = 'customer' THEN runet.net_revenue ELSE 0 END) as customer_blocked"),
    ])
    .first();

  const variantBlocked = requireRow(
    variantBlockedRevenueRows as Omit<BlockedRevenueRow, 'operational_blocked'> | undefined,
    'variantBlockedRevenueRows'
  );
  const revenueBlockedInventory = Number(variantBlocked.inventory_blocked ?? 0);
  const revenueBlockedCustomer = Number(variantBlocked.customer_blocked ?? 0);

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