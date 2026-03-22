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
     * SNAPSHOT IDENTITY (REBUILD SAFE)
     * --------------------------------
     * Using DATE collapses multiple events into one row.
     * This breaks deterministic rebuild.
     *
     * We MUST use full timestamp to preserve event ordering.
     */
    const snapshotDateNormalized = snapshotDate.toISOString();

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
     * BLOCKED REVENUE (CANONICAL — VARIANT-SCOPED)
     * --------------------------------------------
     * MUST derive from order_constraints
     * DO NOT use order_risk_snapshot booleans
     */
    const blockedRevenueRows = await trx('order_revenue_units_net as runet')
        .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
        .leftJoin('order_constraints as oc', function () {
            this.on('oc.lasyncro_order_id', '=', 'runet.lasyncro_order_id')
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

    /**
     * DEBUG SIGNAL
     */
    console.debug('[SNAPSHOT][BLOCKED_REVENUE]', {
        shopId,
        snapshotCutoff,
        inventory: Number((blockedRevenueRows as any)?.inventory_blocked ?? 0),
        customer: Number((blockedRevenueRows as any)?.customer_blocked ?? 0),
        operational: Number((blockedRevenueRows as any)?.operational_blocked ?? 0)
    });
    
    /**
     * TOP BLOCKING TYPE (REAL COMPUTATION)
     * ------------------------------------
     * Must reflect actual blocked revenue values.
     */
    const inventoryBlocked = Number((blockedRevenueRows as any)?.inventory_blocked ?? 0);
    const customerBlocked = Number((blockedRevenueRows as any)?.customer_blocked ?? 0);
    const operationalBlocked = Number((blockedRevenueRows as any)?.operational_blocked ?? 0);

    /**
     * TOP BLOCKING TYPE — GUARANTEED
     * --------------------------------
     * System must always produce a dominant driver.
     * "none" is forbidden — it destroys operator trust.
     */
    let topBlockingType: 'inventory' | 'customer' | 'operational' = 'inventory';

    /**
     * Always select highest value — even if all are 0
     */
    if (customerBlocked >= inventoryBlocked && customerBlocked >= operationalBlocked) {
        topBlockingType = 'customer';
    } else if (operationalBlocked >= inventoryBlocked) {
        topBlockingType = 'operational';
    } else {
        topBlockingType = 'inventory';
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
     * CONSTRAINED ORDERS (CANONICAL)
     * -------------------------------
     * Source of truth:
     *   order_constraints (NOT events)
     *
     * MUST:
     * - use is_active = true
     * - respect snapshotCutoff
     * - count DISTINCT orders
     *
     * This metric drives Control Tower.
     */
    const constrainedOrdersRow = await trx('order_constraints as oc')
    .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
    .where('o.shop_id', shopId)
    .andWhere('oc.is_active', true)
    .andWhere('o.order_created_at', '<=', snapshotCutoff)
    .countDistinct<{ count: string }>('oc.lasyncro_order_id as count')
    .first();

    /**
     * VISIBILITY — CRITICAL METRIC TRACE
     */
    console.debug('[SNAPSHOT][CONSTRAINED_ORDERS]', {
    shopId,
    snapshotCutoff,
    count: Number(constrainedOrdersRow?.count ?? 0)
    });

    /**
     * DEBUG SIGNAL
     */
    console.debug('[SNAPSHOT][CONSTRAINED_ORDERS]', {
        shopId,
        count: Number(constrainedOrdersRow?.count ?? 0)
    });

    /**
     * LOAD SHOP SLA
     * ----------------
     * Single source-of-truth for operational timing expectations.
     */
    const shopSettings = await trx('shop_operational_settings')
      .where({ shop_id: shopId })
      .first();

    const fulfillmentSlaHours = shopSettings?.fulfillment_sla_hours ?? 24;
    const fulfillmentSlaSeconds = fulfillmentSlaHours * 3600;

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
            /**
             * SLA-AWARE AGING BUCKETS
             * ------------------------
             * fulfillmentSlaSeconds MUST be injected as a bound value.
             * Never interpolated as identifier (prevents SQL runtime failure).
             */
            trx.raw(
            `COUNT(*) FILTER (WHERE age_since_paid_seconds < ?) as aging_under_24h`,
            [fulfillmentSlaSeconds]
            ),
            trx.raw(
            `COUNT(*) FILTER (
                WHERE age_since_paid_seconds >= ?
                AND age_since_paid_seconds < 172800
            ) as aging_48h`,
            [fulfillmentSlaSeconds]
            ),
            trx.raw(`COUNT(*) FILTER (WHERE age_since_paid_seconds >= 172800) as aging_72h_plus`)
        )
        .first();

    const ordersAtSlaRiskRow = await trx('order_age_snapshot as oas')
        .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .andWhere('o.order_created_at', '<=', snapshotCutoff) 
        .andWhere('oas.age_since_paid_seconds', '>', fulfillmentSlaSeconds)
        .count<{ count: string }>('oas.lasyncro_order_id as count')
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
        .andWhere('oas.age_since_paid_seconds', '>=', fulfillmentSlaSeconds)
        .sum<{ sum: string }>('o.total_price as sum')
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
            console.warn('[SNAPSHOT_SKIPPED_EXISTS]', {
                shopId,
                snapshotDate: snapshotDateNormalized,
                reason: 'append-only snapshot prevented overwrite'
            });

            return;
        }

        if (existingSnapshot) {
            console.warn('[SNAPSHOT_SKIPPED_EXISTS]', {
                shopId,
                snapshotDate: snapshotDateNormalized,
                reason: 'append-only snapshot prevented overwrite'
            });

            return;
        }

    /**
     * SNAPSHOT WRITE
     */
    const snapshotPayload = {
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
            /**
             * HARD TYPE CAST — PREVENT BOOLEAN COERCION
             * -----------------------------------------
             * Postgres driver may coerce improperly if value is string/undefined.
             * Must force strict integer.
             */
            constrained_orders: parseInt(String(constrainedOrdersRow?.count ?? '0'), 10),
            oldest_exception_order_age_hours: Number((oldestExceptionAgeRow?.max ?? 0) / 3600),

            queue_manual_review: Number(queueManualReview?.count ?? 0),
            queue_awaiting_inventory: Number(queueAwaitingInventory?.count ?? 0),
            ready_to_ship_revenue: Number(readyToShipRevenue?.sum ?? 0),
            
            queue_awaiting_customer: Number(queueAwaitingCustomer?.count ?? 0),

            evaluated_at: snapshotDate
        }

        console.debug('[SNAPSHOT][PAYLOAD]', snapshotPayload);

        await trx('orders_operational_control_snapshot')
            .insert(snapshotPayload);

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