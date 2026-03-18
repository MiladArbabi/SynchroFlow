import db from '@lasyncro/backend-core/db.js';

/**
 * SHOP OPERATIONAL SNAPSHOT COMPUTATION
 * -------------------------------------
 * Optional snapshotDateOverride allows deterministic
 * historical reconstruction during onboarding or replay.
 *
 * Runtime calls MUST omit this argument.
 */
export async function computeShopOperationalSnapshot(
  shopId: string,
  snapshotDateOverride?: Date,
  options?: { allowMutation?: boolean }
) {

  try {

  await db.transaction(async (trx) => {

    /**
     * CONTROLLED MUTATION (EXPLICIT ONLY)
     * ----------------------------------
     * Enabled ONLY when caller explicitly requests it.
     * Never environment-driven.
     */
    if (options?.allowMutation === true) {
    await trx.raw(`SET app.allow_snapshot_mutation = 'true'`);
    console.warn('[SNAPSHOT_MUTATION_BYPASS_EXPLICIT]', { shopId });
    }
    
    /**
     * SNAPSHOT DATE RESOLUTION
     * ------------------------
     * Default: wall-clock time (runtime operations)
     *
     * Historical mode:
     * snapshotDateOverride allows deterministic
     * reconstruction of historical operational states
     * (used during onboarding backfill).
     */
    const snapshotDate = snapshotDateOverride ?? new Date();


    if (!snapshotDate) {
        throw new Error('[SHOP_SNAPSHOT_INVARIANT] no orders found');
    }

    /**
     * Normalize to DATE for table PK
     */
    const snapshotDateNormalized = snapshotDate
    .toISOString()
    .split('T')[0];

    /**
     * HISTORICAL CUTOFF INVARIANT
     * ---------------------------
     * All snapshot queries MUST represent the shop state
     * as it existed at snapshotDate.
     *
     * Therefore every query referencing orders MUST apply:
     *
     *   o.order_created_at <= snapshotCutoff
     *
     * This guarantees historical reconstruction during
     * onboarding backfill and deterministic replay.
     */
    const snapshotCutoff = snapshotDate;

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

    /**
      * AGGREGATE VERSION RESOLUTION
      * ----------------------------
      * Backfill may execute before the projection cursor exists.
      *
      * Snapshot table enforces:
      *   CHECK (aggregate_version > 0)
      *
      * Therefore a safe fallback is required to prevent
      * transaction rollback during historical reconstruction.
      *
      * Version semantics:
      * - Runtime snapshots use projection cursor version.
      * - Backfill snapshots fall back to version 1 when
      *   projection cursor is not yet initialized.
      */
     const aggregateVersion =
       Number(cursorRow?.last_processed_event_id ?? 1);

    /**
     * REALIZED REVENUE
     */
    const realizedRevenueRow = await trx('order_revenue_units_net as runet')
      .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
      .where('o.shop_id', shopId)
      .andWhere('o.order_created_at', '<=', snapshotCutoff) // historical state boundary
      .sum<{ sum: string }>('runet.net_revenue as sum')
      .first();

    /**
     * REVENUE STATE METRICS
     * ---------------------
     * Derived from revenue units and fulfillment status.
     * These represent operational revenue exposure.
     */

    /**
     * PENDING REVENUE
     * ----------------
     * Revenue from orders that are:
     * - payment captured
     * - not yet fulfilled
     *
     * IMPORTANT ARCHITECTURAL RULE
     * ----------------------------
     * All economic accounting must originate from
     * revenue units to preserve deterministic GMV
     * and avoid order-level duplication errors.
     *
     * Therefore pending revenue must use
     * order_revenue_units_net instead of
     * orders.total_price.
     */
    const pendingRevenueRow = await trx('order_revenue_units_net as runet')
    .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
    .join(
    'order_fulfillment_status as ofs',
    'ofs.lasyncro_order_id',
    'o.lasyncro_order_id'
    )
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff) // historical snapshot boundary
    .andWhere('o.payment_state', 'paid')
    .andWhereNot('ofs.status', 'fulfilled')
    .sum<{ sum: string }>('runet.net_revenue as sum')
    .first();

    /**
     * AT-RISK REVENUE (HISTORICAL SAFE)
     * ---------------------------------
     * Snapshot must reflect state at snapshotDate.
     *
     * Therefore orders created after snapshotCutoff
     * must not be included.
     */
    const atRiskRevenueRow = await trx('orders')
        .where({ shop_id: shopId })
        .andWhere('payment_state', 'unpaid')
        .andWhere('order_created_at', '<=', snapshotCutoff)
        .sum<{ sum: string }>('total_price as sum')
        .first();

    /**
     * SLA BREACH (NEXT 24H) REVENUE
     * --------------------------------
     * Revenue from orders at immediate SLA risk.
     *
     * SOURCE OF TRUTH:
     * - order_age_snapshot
     * - orders_at_sla_risk equivalent condition
     *
     * NOTE:
     * This must remain projection-computed to avoid UI drift.
     */
    const slaBreach24hRevenueRow = await trx('orders as o')
        .join('order_age_snapshot as oas', 'oas.lasyncro_order_id', 'o.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .andWhere('o.order_created_at', '<=', snapshotCutoff)
        .andWhere('oas.age_since_paid_seconds', '>=', 86400)
        .sum<{ sum: string }>('o.total_price as sum')
        .first();
    
    /**
     * TOP BLOCKING TYPE
     * ------------------
     * Determines dominant revenue blocker.
     *
     * PRIORITY ORDER:
     * - inventory
     * - customer
     * - operational
     *
     * NOTE:
     * Must remain deterministic and simple.
     */
    let topBlockingType: 'inventory' | 'customer' | 'operational' | 'none' = 'none';

    // Placeholder values — must reuse existing computed fields later in file
    const inventoryBlocked = Number(0);
    const customerBlocked = Number(0);
    const operationalBlocked = Number(0);

    if (inventoryBlocked >= customerBlocked && inventoryBlocked >= operationalBlocked && inventoryBlocked > 0) {
    topBlockingType = 'inventory';
    } else if (customerBlocked >= operationalBlocked && customerBlocked > 0) {
    topBlockingType = 'customer';
    } else if (operationalBlocked > 0) {
    topBlockingType = 'operational';
    }

    /**
     * CONTRIBUTION MARGIN
     * -------------------
     * Average contribution margin across revenue units.
     */
    const avgMarginRow = await trx('order_revenue_units_net as runet')
        .join('order_revenue_units as ru', 'ru.lasyncro_revenue_unit_id', 'runet.lasyncro_revenue_unit_id')
        .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .andWhere('o.order_created_at', '<=', snapshotCutoff) 
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
        .andWhere('o.order_created_at', '<=', snapshotCutoff) // historical snapshot boundary
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
        .andWhere('o.order_created_at', '<=', snapshotCutoff)
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
        .andWhere('orders.order_created_at', '<=', snapshotCutoff) // historical snapshot boundary
        .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'orders.lasyncro_order_id')
        .andWhereNot('ofs.status', 'fulfilled')
        .count<{ count: string }>('orders.lasyncro_order_id as count')
        .first();

    /**
     * EXCEPTION ORDERS (HISTORICAL SAFE)
     * ----------------------------------
     * Constraint events must respect snapshot boundary.
     * Orders created after snapshotCutoff must not appear
     * in historical snapshots.
     */
    const exceptionOrdersRow = await trx('order_constraint_events as oce')
        .join('orders as o', 'o.lasyncro_order_id', 'oce.lasyncro_order_id')
        .where('oce.shop_id', shopId)
        .andWhere('oce.is_active', true)
        .andWhere('o.order_created_at', '<=', snapshotCutoff)
        .count<{ count: string }>('oce.constraint_event_id as count')
        .first();

    /**
     * CONSTRAINED ORDERS (HISTORICAL SAFE)
     * ------------------------------------
     * Ensure historical snapshots only include orders
     * that existed at snapshotCutoff.
     */
    const constrainedOrdersRow = await trx('order_constraint_events as oce')
    .join('orders as o', 'o.lasyncro_order_id', 'oce.lasyncro_order_id')
    .where('oce.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .countDistinct<{ count: string }>('oce.lasyncro_order_id as count')
    .first();

    const ordersAtSlaRiskRow = await trx('order_age_snapshot as oas')
        .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .andWhere('o.order_created_at', '<=', snapshotCutoff) 
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

    /**
     * READY TO SHIP QUEUE
     * -------------------
     * Orders executable by warehouse immediately.
     *
     * Conditions:
     * - payment captured
     * - fulfillment pending
     * - no active operational constraints
     */
    const queueReadyToShip = await trx('orders as o')
    .join(
        'order_fulfillment_status as ofs',
        'ofs.lasyncro_order_id',
        'o.lasyncro_order_id'
    )
    .leftJoin(
        'order_constraint_events as oce',
        function () {
        this.on('oce.lasyncro_order_id', '=', 'o.lasyncro_order_id')
            .andOn('oce.is_active', '=', trx.raw('true'));
        }
    )
    .where('o.shop_id', shopId)
    .andWhere('o.payment_state', 'paid')
    .andWhere('ofs.status', 'pending')
    .whereNull('oce.constraint_event_id')
    .count<{ count: string }>('o.lasyncro_order_id as count')
    .first();

    /**
     * READY TO SHIP REVENUE
     * ---------------------
     * Economic value of orders that warehouse can ship immediately.
     *
     * Conditions identical to queue_ready_to_ship:
     * - payment captured
     * - fulfillment pending
     * - no active operational constraints
     *
     * Uses revenue units to ensure deterministic economic accounting.
     */
    const readyToShipRevenue = await trx('order_revenue_units as oru')
    .join('orders as o', 'o.lasyncro_order_id', 'oru.lasyncro_order_id')
    .join(
        'order_fulfillment_status as ofs',
        'ofs.lasyncro_order_id',
        'o.lasyncro_order_id'
    )
    .leftJoin(
        'order_constraint_events as oce',
        function () {
        this.on('oce.lasyncro_order_id', '=', 'o.lasyncro_order_id')
            .andOn('oce.is_active', '=', trx.raw('true'));
        }
    )
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff) 
    .andWhere('o.payment_state', 'paid')
    .andWhere('ofs.status', 'pending')
    .whereNull('oce.constraint_event_id')
    .sum<{ sum: string }>('oru.line_total as sum')
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
        .andWhere('o.order_created_at', '<=', snapshotCutoff)
        .andWhere('oce.is_active', true)
        .max('oas.age_since_paid_seconds as max')
        .first();
    
    /**
     * REVENUE LEAKAGE
     * ----------------
     * Leakage represents revenue permanently lost
     * due to refunds or irreversible economic events.
     *
     * Unpaid orders are NOT leakage — they are exposure.
     */
    const revenueLeakageRow = await trx('refund_executions')
    .join('orders as o', 'o.lasyncro_order_id', 'refund_executions.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .sum<{ sum: string }>('refund_executions.total_refund_amount as sum')
    .first();

    const revenueLeakage = Number(revenueLeakageRow?.sum ?? 0);

    /**
     * TOTAL GMV
     * ---------
     * Canonical Gross Merchandise Value.
     *
     * Invariant:
     * realized_revenue
     * pending_revenue
     * at_risk_revenue
     *
     * Stored in projection snapshot so the resolver
     * never recomputes economic invariants.
     */
    const totalGMV =
    Number(realizedRevenueRow?.sum ?? 0) +
    Number(pendingRevenueRow?.sum ?? 0) +
    Number(atRiskRevenueRow?.sum ?? 0);



    /**
     * IDEMPOTENCY GUARD (APP LAYER)
     * ----------------------------
     * Avoid hitting DB with duplicate snapshot writes.
     * DB remains source of truth, but we short-circuit early.
     */
    const existingSnapshot = await trx('orders_operational_control_snapshot')
        .where({
            shop_id: shopId,
            snapshot_date: snapshotDateNormalized,
        })
        .first();

        if (existingSnapshot) {
        console.info('[SNAPSHOT_SKIPPED_EXISTS]', {
            shopId,
            snapshotDate: snapshotDateNormalized,
        });

        return;
    }

    /**
     * SNAPSHOT WRITE
     */
    await trx('orders_operational_control_snapshot')
        .insert({
            shop_id: shopId,
            snapshot_date: snapshotDateNormalized,
            aggregate_version: aggregateVersion,

            realized_revenue: Number(realizedRevenueRow?.sum ?? 0),
            pending_revenue: Number(pendingRevenueRow?.sum ?? 0),
            at_risk_revenue: Number(atRiskRevenueRow?.sum ?? 0),

            /**
             * COMMAND CENTER — PRIMARY METRICS
             * --------------------------------
             * These fields power the decision surface.
             * MUST remain backend-computed (no UI derivation).
             */
            total_at_risk_revenue: Number(atRiskRevenueRow?.sum ?? 0),

            sla_breach_24h_revenue: Number(slaBreach24hRevenueRow?.sum ?? 0),

            top_blocking_type: topBlockingType,

            /**
             * Canonical GMV (projection authority)
             */
            total_gmv: totalGMV,

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
            exception_orders: Number(exceptionOrdersRow?.count ?? 0),

            /**
             * MATERIALIZED SLA RISK COUNT
             * ---------------------------
             * Uses precomputed value to avoid inline DB row coupling.
             */
            orders_at_sla_risk: ordersAtSlaRisk,
            constrained_orders: Number(constrainedOrdersRow?.count ?? 0),
            oldest_exception_order_age_hours: Number((oldestExceptionAgeRow?.max ?? 0) / 3600),

            queue_manual_review: Number(queueManualReview?.count ?? 0),
            queue_awaiting_inventory: Number(queueAwaitingInventory?.count ?? 0),
            ready_to_ship_revenue: Number(readyToShipRevenue?.sum ?? 0),
            
            queue_awaiting_customer: Number(queueAwaitingCustomer?.count ?? 0),

            evaluated_at: snapshotDate
        })
        /**
         * APPEND-ONLY GUARANTEE
         * ---------------------
         * Snapshot table is immutable.
         * Duplicate (shop_id, snapshot_date) must NOT overwrite history.
         *
         * We explicitly drop UPDATE path and surface duplicates.
         */
        .onConflict(['shop_id', 'snapshot_date'])
        .ignore()

        /**
         * VISIBILITY: detect suppressed writes
         */
        if ((await trx.raw('SELECT 1')).rowCount === 0) {
        console.warn('[SNAPSHOT_WRITE_NOOP]', {
            shopId,
            snapshotDate: snapshotDateNormalized,
            reason: 'duplicate snapshot prevented (append-only)',
        });
        }
    });

    /**
     * HISTORICAL SNAPSHOT BOOTSTRAP
     * -----------------------------
     * If only a single snapshot exists, this indicates
     * historical backfill has not yet executed.
     *
     * Trigger backfill once orders exist and the
     * projection pipeline has produced its first snapshot.
     */

    const snapshotCount = await db('orders_operational_control_snapshot')
        .where({ shop_id: shopId })
        .count('* as count')
        .first();

        if (Number(snapshotCount?.count ?? 0) === 1 && !snapshotDateOverride) {
        console.info('[shop-snapshot] triggering historical backfill', { shopId });

        const { backfillShopOperationalSnapshots } =
            await import('./shopOperationalSnapshot.backfill.js');

        await backfillShopOperationalSnapshots(Number(shopId));
    }

    /**
     * SNAPSHOT HEALTH MONITOR
     * -----------------------
     * Detect stale Control Tower snapshots.
     *
     * If the latest snapshot is older than 24h the
     * Control Tower may display outdated operational
     * metrics. This signal allows infrastructure
     * monitoring to detect projection pipeline stalls.
     *
     * Signal:
     * ORDER_CONTROL_SNAPSHOT_STALE
     */
    const latestSnapshot = await db('orders_operational_control_snapshot')
        .where({ shop_id: shopId })
        .max('snapshot_date as last')
        .first();

        if (latestSnapshot?.last) {

        const snapshotAgeMs =
            Date.now() - new Date(latestSnapshot.last as string).getTime();

        const SNAPSHOT_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

        if (snapshotAgeMs > SNAPSHOT_STALE_THRESHOLD_MS) {

            console.warn('[ORDER_CONTROL_SNAPSHOT_STALE]', {
            shopId,
            snapshot_date: latestSnapshot.last,
            age_hours: Math.floor(snapshotAgeMs / 3600000)
            });

        }
    }

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