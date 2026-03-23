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

  const blockedRevenueRows = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .leftJoin('order_constraints as oc', (join) => {
      join.on('oc.lasyncro_order_id', '=', 'runet.lasyncro_order_id')
        .andOn('oc.target_id', '=', 'runet.lasyncro_variant_id')
        /**
         * DB CONTRACT: avoid raw boolean usage
         */
        .andOn('oc.is_active', '=', trx.client.raw('?', [true]));
    })
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    /**
     * DB CONTRACT: explicit aggregation columns (typed + inspectable)
     */
    .select([
      trx.raw("SUM(CASE WHEN oc.constraint_type = 'inventory' THEN runet.net_revenue ELSE 0 END) as inventory_blocked"),
      trx.raw("SUM(CASE WHEN oc.constraint_type = 'customer' THEN runet.net_revenue ELSE 0 END) as customer_blocked"),
      trx.raw("SUM(CASE WHEN oc.constraint_type = 'operational' THEN runet.net_revenue ELSE 0 END) as operational_blocked"),
    ])
    .first();

  const blocked = requireRow(
    blockedRevenueRows as BlockedRevenueRow | undefined,
    'blockedRevenueRows'
  );

  const revenueBlockedInventory = Number(blocked.inventory_blocked ?? 0);
  const revenueBlockedCustomer = Number(blocked.customer_blocked ?? 0);
  const revenueBlockedOperational = Number(blocked.operational_blocked ?? 0);

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