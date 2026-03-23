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
  const blockedRevenueRows = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .leftJoin('order_constraints as oc', (join) => {
      join.on('oc.lasyncro_order_id', '=', 'runet.lasyncro_order_id')
        .andOn('oc.target_id', '=', 'runet.lasyncro_variant_id')
        .andOn('oc.is_active', '=', trx.raw('true'));
    })
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .select(
      trx.raw(`
        SUM(CASE WHEN oc.constraint_type = 'inventory' THEN runet.net_revenue ELSE 0 END) as inventory_blocked,
        SUM(CASE WHEN oc.constraint_type = 'customer' THEN runet.net_revenue ELSE 0 END) as customer_blocked,
        SUM(CASE WHEN oc.constraint_type = 'operational' THEN runet.net_revenue ELSE 0 END) as operational_blocked
      `)
    )
    .first();

  const revenueBlockedInventory = Number((blockedRevenueRows as any)?.inventory_blocked ?? 0);
  const revenueBlockedCustomer = Number((blockedRevenueRows as any)?.customer_blocked ?? 0);
  const revenueBlockedOperational = Number((blockedRevenueRows as any)?.operational_blocked ?? 0);

  const blockedRevenueTotal =
    revenueBlockedInventory +
    revenueBlockedCustomer +
    revenueBlockedOperational;

  const constrainedOrdersRow = await trx('order_constraints as oc')
    .where('oc.shop_id', shopId)
    .andWhere('oc.created_at', '<=', snapshotCutoff)
    .count('distinct oc.lasyncro_order_id as count')
    .first();

  const constrainedOrders = parseInt(
    String((constrainedOrdersRow as any)?.count ?? '0'),
    10
  );

  return {
    revenueBlockedInventory,
    revenueBlockedCustomer,
    revenueBlockedOperational,
    blockedRevenueTotal,
    constrainedOrders,
  };
}