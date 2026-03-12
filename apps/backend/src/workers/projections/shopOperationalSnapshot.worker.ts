import db from '@lasyncro/backend-core/db.js';

/**
 * SHOP OPERATIONAL SNAPSHOT WORKER
 * --------------------------------
 * Computes deterministic shop-level operational metrics.
 *
 * Architectural rule:
 * - Must run OUTSIDE per-order reconciliation
 * - Must evaluate full shop state
 *
 * Trigger model (initial):
 * - Safe to run periodically
 * - Deterministic recomputation
 *
 * Future improvements:
 * - queue-driven shop snapshot trigger
 */
export async function computeShopOperationalSnapshot(shopId: string) {

  console.info('[shop-snapshot] recompute started', {
    shopId
  });

  try {

  await db.transaction(async (trx) => {
    /**
     * SNAPSHOT DATE
     * -------------
     * Anchored to deterministic projection time.
     * No wall-clock influence allowed.
     */
    const snapshotDateRow = await trx('orders')
      .where({ shop_id: shopId })
      .max('order_updated_at as ts')
      .first();

    const snapshotDate = snapshotDateRow?.ts;

    if (!snapshotDate) {
      throw new Error('[SHOP_SNAPSHOT_INVARIANT] no orders found');
    }

    /**
     * SHOP SNAPSHOT VERSION SOURCE
     * ----------------------------
     * Shop operational snapshot must derive its version
     * from projection progress rather than order aggregates.
     *
     * projection_cursors represents the canonical replay
     * position of the projection engine.
     */
    const cursorRow = await trx('projection_cursors')
    .where({ projection_name: 'orders_projection' })
    .select('last_processed_event_id')
    .first();

    const aggregateVersion = Number(cursorRow?.last_processed_event_id ?? 0);

    /**
     * REALIZED REVENUE
     */
    const realizedRevenueRow = await trx('order_revenue_units_net as runet')
      .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .sum<{ sum: string }>('runet.net_revenue as sum')
      .first();

    /**
     * REVENUE STATE METRICS
     * ---------------------
     * Derived from revenue units and fulfillment status.
     * These represent operational revenue exposure.
     */

    const pendingRevenueRow = await trx('order_revenue_units_net as runet')
        .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
        .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'o.lasyncro_order_id')
        .where('o.shop_id', shopId)
        /**
         * PENDING REVENUE FILTER
         * ----------------------
         * Orders table does not contain order_status.
         * Fulfillment state is represented in
         * order_fulfillment_status.status.
         */
        .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'o.lasyncro_order_id')
        .andWhereNot('ofs.status', 'fulfilled')
        .sum<{ sum: string }>('runet.net_revenue as sum')
        .first();

    const atRiskRevenueRow = await trx('order_revenue_units_net as runet')
        .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
        .join('order_age_snapshot as oas', 'oas.lasyncro_order_id', 'o.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .andWhere('oas.age_since_paid_seconds', '>', 86400)
        .sum<{ sum: string }>('runet.net_revenue as sum')
        .first();

    /**
     * CONTRIBUTION MARGIN
     * -------------------
     * Average contribution margin across revenue units.
     */
    const avgMarginRow = await trx('order_revenue_units_net as runet')
        .join('order_revenue_units as ru', 'ru.lasyncro_revenue_unit_id', 'runet.lasyncro_revenue_unit_id')
        .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .avg<{ avg: string }>(
            trx.raw('(runet.net_revenue - ru.estimated_unit_cost) / NULLIF(runet.net_revenue,0)')
        )
        .first();

    /**
     * ORDER AGING BUCKETS
     * -------------------
     * Deterministic aging derived from order_age_snapshot.
     * These buckets drive operational SLA visibility.
     */
    const agingBuckets = await trx('order_age_snapshot as oas')
        .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .select(
            trx.raw(`COUNT(*) FILTER (WHERE age_since_paid_seconds < 86400) as aging_under_24h`),
            trx.raw(`COUNT(*) FILTER (WHERE age_since_paid_seconds >= 86400 AND age_since_paid_seconds < 172800) as aging_48h`),
            trx.raw(`COUNT(*) FILTER (WHERE age_since_paid_seconds >= 172800) as aging_72h_plus`)
        )
        .first();

    /**
     * BLOCKED REVENUE
     * ----------------
     * Revenue attached to orders blocked by operational constraints.
     */
    const blockedRevenueRows = await trx('order_revenue_units_net as runet')
        .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
        .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'o.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .select(
            trx.raw(`
                SUM(CASE WHEN ors.is_inventory_blocked THEN runet.net_revenue ELSE 0 END) as inventory_blocked,
                SUM(CASE WHEN ors.is_customer_blocked THEN runet.net_revenue ELSE 0 END) as customer_blocked,
                SUM(CASE WHEN ors.is_operational_blocked THEN runet.net_revenue ELSE 0 END) as operational_blocked
            `)
        )
        .first();
    
    /**
     * BLOCKED REVENUE TOTAL
     * ---------------------
     * The snapshot schema requires a unified blocked_revenue field.
     * It represents the sum of all constraint categories.
     *
     * This must be computed deterministically from the
     * per-constraint revenue already calculated above.
     */
    const blockedRevenueTotal =
    Number((blockedRevenueRows as any)?.inventory_blocked ?? 0) +
    Number((blockedRevenueRows as any)?.customer_blocked ?? 0) +
    Number((blockedRevenueRows as any)?.operational_blocked ?? 0);

    /**
     * SHOP OPERATIONAL METRICS
     * ------------------------
     * All metrics must be recomputed deterministically
     * from current shop state. No incremental mutation.
     *
     * This preserves replay rebuild guarantees.
     */

    const pendingFulfillmentRow = await trx('orders')
        .where({ shop_id: shopId })
        .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'orders.lasyncro_order_id')
        .andWhereNot('ofs.status', 'fulfilled')
        .count<{ count: string }>('orders.lasyncro_order_id as count')
        .first();

    const exceptionOrdersRow = await trx('order_constraint_events')
        .where({ shop_id: shopId, is_active: true })
        .count<{ count: string }>('constraint_event_id as count')
        .first();

    /**
     * CONSTRAINT + SLA RISK METRICS
     * -----------------------------
     * Derived from constraint events and order age projection.
     */
    const constrainedOrdersRow = await trx('order_constraint_events')
        .where({ shop_id: shopId })
        .countDistinct<{ count: string }>('lasyncro_order_id as count')
        .first();

    const ordersAtSlaRiskRow = await trx('order_age_snapshot as oas')
        .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .andWhere('oas.age_since_paid_seconds', '>', 86400)
        .count<{ count: string }>('oas.lasyncro_order_id as count')
        .first();
    
    /**
     * MATERIALIZE SLA RISK COUNT
     * --------------------------
     * Snapshot schema requires a concrete integer value.
     * Avoid passing raw DB row structures into snapshot writes.
     */
    const ordersAtSlaRisk = Number(ordersAtSlaRiskRow?.count ?? 0);

    /**
     * PAYMENT STATE SOURCE OF TRUTH
     * -----------------------------
     * Orders table does not contain `financial_status`.
     * Canonical column is `payment_state` derived during ingestion.
     */
    const pendingPaymentRow = await trx('orders')
    .where({ shop_id: shopId })
    .andWhere('payment_state', 'unpaid')
    .count<{ count: string }>('orders.lasyncro_order_id as count')
    .first();

    /**
     * QUEUE METRICS
     */
    const queueManualReview = await trx('order_constraint_events')
        .where({ shop_id: shopId, constraint_type: 'operational', is_active: true })
        .count<{ count: string }>('constraint_event_id as count')
        .first();

    const queueAwaitingInventory = await trx('order_constraint_events')
        .where({ shop_id: shopId, constraint_type: 'inventory', is_active: true })
        .count<{ count: string }>('constraint_event_id as count')
        .first();

    const queueAwaitingCustomer = await trx('order_constraint_events')
        .where({ shop_id: shopId, constraint_type: 'customer', is_active: true })
        .count<{ count: string }>('constraint_event_id as count')
        .first();

    const queueReadyToShip = await trx('orders')
        .where({ shop_id: shopId })
        .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'orders.lasyncro_order_id')
        .andWhere('ofs.status', 'pending')
        .count<{ count: string }>('orders.lasyncro_order_id as count')
        .first();
    
    /**
     * PARTIAL FULFILLMENT OPPORTUNITY
     * -------------------------------
     * Orders with mixed availability across line items.
     */
    const partialFulfillmentOpportunity = await trx('order_revenue_units')
        .join('orders as o', 'o.lasyncro_order_id', 'order_revenue_units.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .countDistinct<{ count: string }>('order_revenue_units.lasyncro_order_id as count')
        .first();

    /**
     * OLDEST EXCEPTION ORDER AGE
     * --------------------------
     * Identifies the longest unresolved operational exception.
     */
    const oldestExceptionAgeRow = await trx('order_age_snapshot as oas')
        .join('order_constraint_events as oce', 'oce.lasyncro_order_id', 'oas.lasyncro_order_id')
        .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .andWhere('oce.is_active', true)
        .max('oas.age_since_paid_seconds as max')
        .first();
    
    /**
     * REVENUE LEAKAGE
     * ---------------
     * Placeholder deterministic computation until
     * a dedicated leakage model is introduced.
     *
     * Uses at-risk revenue as conservative signal.
     */
    const revenueLeakage = Number(atRiskRevenueRow?.sum ?? 0);

    /**
     * SNAPSHOT WRITE
     */
    await trx('orders_operational_control_snapshot')
        .insert({
            shop_id: shopId,
            snapshot_date: snapshotDate,
            aggregate_version: aggregateVersion,

            realized_revenue: Number(realizedRevenueRow?.sum ?? 0),

            pending_revenue: Number(pendingRevenueRow?.sum ?? 0),
            at_risk_revenue: Number(atRiskRevenueRow?.sum ?? 0),
            avg_contribution_margin_pct: Number(avgMarginRow?.avg ?? 0),

            /**
             * ORDER AGING METRICS
             * -------------------
             * Derived from order_age_snapshot projection.
             * These buckets expose SLA risk and fulfillment backlog.
             */
            aging_under_24h: Number((agingBuckets as any)?.aging_under_24h ?? 0),
            aging_48h: Number((agingBuckets as any)?.aging_48h ?? 0),
            aging_72h_plus: Number((agingBuckets as any)?.aging_72h_plus ?? 0),

            /**
             * BLOCKED REVENUE METRICS
             * -----------------------
             * Revenue currently constrained by operational blocks.
             */
            revenue_blocked_inventory: Number((blockedRevenueRows as any)?.inventory_blocked ?? 0),
            revenue_blocked_customer: Number((blockedRevenueRows as any)?.customer_blocked ?? 0),
            revenue_blocked_operational: Number((blockedRevenueRows as any)?.operational_blocked ?? 0),

            /**
             * UNIFIED BLOCKED REVENUE
             * -----------------------
             * Required by schema contract.
             * Represents the total constrained revenue across all block types.
             */
            blocked_revenue: blockedRevenueTotal,

            revenue_leakage: revenueLeakage,

            pending_fulfillment: Number(pendingFulfillmentRow?.count ?? 0),
            pending_payment: Number(pendingPaymentRow?.count ?? 0),

            exception_orders: Number(exceptionOrdersRow?.count ?? 0),

            /**
             * MATERIALIZED SLA RISK COUNT
             * ---------------------------
             * Uses precomputed value to avoid inline DB row coupling.
             */
            orders_at_sla_risk: ordersAtSlaRisk,
            constrained_orders: Number(constrainedOrdersRow?.count ?? 0),
            partial_fulfillment_opportunity: Number(partialFulfillmentOpportunity?.count ?? 0),
            oldest_exception_order_age_hours: Number((oldestExceptionAgeRow?.max ?? 0) / 3600),

            queue_manual_review: Number(queueManualReview?.count ?? 0),
            queue_awaiting_inventory: Number(queueAwaitingInventory?.count ?? 0),
            queue_ready_to_ship: Number(queueReadyToShip?.count ?? 0),
            queue_awaiting_customer: Number(queueAwaitingCustomer?.count ?? 0),

            evaluated_at: snapshotDate
        })
      .onConflict(['shop_id', 'snapshot_date'])
      .merge();
    });

    console.info('[shop-snapshot] recompute completed', {
        shopId
    });

    /**
     * SUCCESS TERMINATION
     * -------------------
     * Explicit return ensures function resolves only
     * after snapshot commit and completion logging.
     */
    return;

    } catch (err) {

    console.error('[shop-snapshot] recompute failed', {
        shopId,
        error: err instanceof Error ? err.message : err
    });

    throw err;
  }
}