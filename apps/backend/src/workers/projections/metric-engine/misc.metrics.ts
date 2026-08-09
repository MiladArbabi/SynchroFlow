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

  /**
   * EXCEPTION ORDERS — POST-RELEASE FLOOR EXCEPTIONS (BL-19, 2026-08-09)
   * --------------------------------------------------------------------
   * An exception order has an UNRESOLVED line-item exception raised during
   * the warehouse lifecycle: released to the floor, not yet shipped.
   *
   * This is deliberately DISJOINT from constrained_orders
   * (constraint.metrics.ts:112), which counts PRE-release blockers. An
   * order cannot hold both: a constrained order was never released, and a
   * released order is no longer constrained.
   *
   * HISTORY: BL-18 fixed this metric's arithmetic (it had counted every
   * order_constraint_events row ever written, 56 vs a truth of 9) but left
   * it reading the pre-release side, making it a duplicate of
   * constrained_orders. Two metrics equal by construction was the signal
   * that one measured the wrong thing.
   *
   * WHY pick_exceptions: post-release by construction. Per BL-01b in
   * operationalConstraintEvaluator.ts, pick_exception_stage is
   * ('pick','pack'), reachable only after /wms/batch/release then /claim.
   *
   * WHY ORDER LEVEL VIA LINE ITEM: pick_exceptions is line-item scoped
   * (lasyncro_line_item_id). The order MUST be resolved through
   * order_line_items, never through pick_batch_orders — a pick_exception
   * points at a batch, and joining batch -> pick_batch_orders fans out to
   * EVERY order in that batch. Verified: one unresolved exception on one
   * line item of one order returned 3 (the batch held 3 orders) instead
   * of 1. countDistinct does not save you; the distinct order ids are
   * real, they are just the wrong ones.
   *
   * pick_batches is still joined, but only on pe.pick_batch_id for the
   * cancelled check — it must not participate in order resolution.
   *
   * WHY THESE EXCLUSIONS:
   * - resolved = false: a resolved exception needs no intervention.
   * - batch not cancelled: the floor work it blocked no longer exists.
   * - order not shipped: order_warehouse_status.status is the canonical
   *   shipped fact, written by the Sendcloud/Shippo tracking handlers on
   *   carrier pickup. partially_shipped still counts — part of the order
   *   is on the floor. LEFT JOIN because a row may not exist yet.
   */
  const exceptionOrdersRow = await trx('pick_exceptions as pe')
    .join(
      'order_line_items as oli',
      'oli.lasyncro_line_item_id',
      'pe.lasyncro_line_item_id'
    )
    .join('pick_batches as pb', 'pb.pick_batch_id', 'pe.pick_batch_id')
    .leftJoin(
      'order_warehouse_status as ows',
      'ows.lasyncro_order_id',
      'oli.lasyncro_order_id'
    )
    .where('pe.shop_id', shopId)
    .andWhere('pe.raised_at', '<=', snapshotCutoff)
    .andWhere('pe.resolved', false)
    .andWhere('pb.status', '<>', 'cancelled')
    .andWhere(function () {
      this.whereNull('ows.status').orWhereNot('ows.status', 'shipped');
    })
    .countDistinct('oli.lasyncro_order_id as count')
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