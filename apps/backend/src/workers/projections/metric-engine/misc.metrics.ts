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

  /**
   * SAFE ACCESS: enforce DB row contracts for misc metrics
   */
  type CountRow = { count: number | string | null };
  type SumRow = { sum: number | string | null };
  type AvgRow = { avg: number | string | null };
  type MaxRow = { max: number | string | null };

  function requireRow<T>(row: T | undefined, label: string): T {
    if (!row) {
      throw new Error(`[misc.metrics] Missing ${label} — DB contract violation`);
    }
    return row;
  }

  const cursorRow = await trx('projection_cursors')
    .where({ projection_name: 'orders_projection' })
    .select('last_processed_event_id')
    .first();

  const aggregateVersion = Number(cursorRow?.last_processed_event_id ?? 1);

  const avgMarginRow = await trx('order_margin_snapshot as oms')
    .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .avg('oms.margin_pct as avg')
    .first();

  const avgContributionMarginPct = Number(
    requireRow(avgMarginRow as AvgRow | undefined, 'avgMarginRow').avg ?? 0
  );

  const pendingFulfillmentRow = await trx('orders as o')
    .where({ shop_id: shopId })
    .andWhere('order_created_at', '<=', snapshotCutoff)
    .whereNotExists(
      trx('order_fulfillment_status as ofs')
        .select(1)
        .whereRaw('ofs.lasyncro_order_id = o.lasyncro_order_id')
        .andWhere('ofs.status', 'fulfilled')
    )
    .count('lasyncro_order_id as count')
    .first();

  const pendingFulfillment = Number(
    requireRow(pendingFulfillmentRow as CountRow | undefined, 'pendingFulfillmentRow').count ?? 0
  );

  const exceptionOrdersRow = await trx('order_constraint_events as oce')
    .where('oce.shop_id', shopId)
    .andWhere('oce.created_at', '<=', snapshotCutoff)
    .count('oce.lasyncro_order_id as count')
    .first();

  const exceptionOrders = Number(
    requireRow(exceptionOrdersRow as CountRow | undefined, 'exceptionOrdersRow').count ?? 0
  );

  const oldestExceptionAgeRow = await trx('order_age_snapshot as oas')
    .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .max('oas.age_since_creation_seconds as max')
    .first();

  /**
   * DB CONTRACT:
   * snapshot column is INTEGER hours
   * MUST floor to avoid float → integer violation
   */
  const oldestExceptionOrderAgeHours = Math.floor(
    Number(
      requireRow(oldestExceptionAgeRow as MaxRow | undefined, 'oldestExceptionAgeRow').max ?? 0
    ) / 3600
  );

    /**
     * CRITICAL: enforce ownership join integrity
     * refund_executions has NO shop_id → MUST always join via orders
     * This guard prevents silent cross-shop leakage if join breaks
     */
    if (!shopId) {
      throw new Error('[misc.metrics] shopId missing for refund_executions join');
    }

  const revenueLeakageRow = await trx('refund_executions as re')
    .join('orders as o', function () {
      this.on('o.lasyncro_order_id', '=', 're.lasyncro_order_id');
    })
    /**
     * DB CONTRACT:
     * refund_executions has NO shop_id
     * shop scope must be derived via orders join
     */
    .where('o.shop_id', shopId)
    .andWhere('re.created_at', '<=', snapshotCutoff)
    .sum('re.total_refund_amount as sum')
    .first();

  const revenueLeakage = Number(
    requireRow(revenueLeakageRow as SumRow | undefined, 'revenueLeakageRow').sum ?? 0
  );

  /**
   * DEBUG SIGNAL: detect unexpected null/NaN leakage
   */
  if (Number.isNaN(revenueLeakage)) {
    throw new Error('[misc.metrics] revenueLeakage NaN — possible join or schema break');
  }

  return {
    aggregateVersion,
    avgContributionMarginPct,
    pendingFulfillment,
    exceptionOrders,
    oldestExceptionOrderAgeHours,
    revenueLeakage,
  };
}