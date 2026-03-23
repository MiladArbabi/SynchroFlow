import type { Knex } from 'knex';

/**
 * MISC METRICS
 * ------------
 * Remaining operational + exception metrics.
 */
export async function computeMiscMetrics(
  trx: Knex.Transaction,
  shopId: string,
  snapshotCutoff: Date
) {
  const cursorRow = await trx('projection_cursors')
    .where({ projection_name: 'orders_projection' })
    .select('last_processed_event_id')
    .first();

  const aggregateVersion = Number(cursorRow?.last_processed_event_id ?? 1);

  const avgMarginRow = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .avg('runet.contribution_margin_pct as avg')
    .first();

  const avgContributionMarginPct = Number((avgMarginRow as any)?.avg ?? 0);

  const pendingFulfillmentRow = await trx('orders')
    .where({ shop_id: shopId })
    .andWhere('order_created_at', '<=', snapshotCutoff)
    .andWhere('fulfillment_status', 'pending')
    .count('lasyncro_order_id as count')
    .first();

  const pendingFulfillment = Number((pendingFulfillmentRow as any)?.count ?? 0);

  const exceptionOrdersRow = await trx('order_constraint_events as oce')
    .where('oce.shop_id', shopId)
    .andWhere('oce.created_at', '<=', snapshotCutoff)
    .count('oce.lasyncro_order_id as count')
    .first();

  const exceptionOrders = Number((exceptionOrdersRow as any)?.count ?? 0);

  const oldestExceptionAgeRow = await trx('order_age_snapshot as oas')
    .where('oas.shop_id', shopId)
    .andWhere('oas.created_at', '<=', snapshotCutoff)
    .max('oas.age_seconds as max')
    .first();

  const oldestExceptionOrderAgeHours = Number(
    ((oldestExceptionAgeRow as any)?.max ?? 0) / 3600
  );

  const revenueLeakageRow = await trx('refund_executions')
    .where({ shop_id: shopId })
    .andWhere('created_at', '<=', snapshotCutoff)
    .sum('amount as sum')
    .first();

  const revenueLeakage = Number((revenueLeakageRow as any)?.sum ?? 0);

  return {
    aggregateVersion,
    avgContributionMarginPct,
    pendingFulfillment,
    exceptionOrders,
    oldestExceptionOrderAgeHours,
    revenueLeakage,
  };
}