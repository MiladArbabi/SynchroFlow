// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
import db from '@lasyncro/backend-core/db.js';
import { ReconciliationResult } from './reconciliation.types.js';
import { writeOrderRevenueUnits } from './revenue-units.writer.js';
import { resolveRefundExecution } from '../refundResolution.worker.js';
import { rebuildInventoryProjectionForVariants } from '../../services/inventory/rebuildInventoryProjection.js';
import { computeObligationFlagsForOrders } from '../../services/order-execution-intelligence/obligationFlags.worker.js';
import crypto from 'crypto';

/**
 * DETERMINISTIC ID GENERATOR
 * --------------------------
 * Stable SHA256-based identifier derived from:
 * - entity type
 * - order id
 * - aggregate version
 *
 * Guarantees:
 * - Replay determinism
 * - Cross-node consistency
 * - No wall-clock influence
 */
function deterministicId(
  entity: string,
  orderId: string,
  aggregateVersion: number
): string {
  return crypto
    .createHash('sha256')
    .update(`${entity}:${orderId}:${aggregateVersion}`)
    .digest('hex')
    .slice(0, 32);
}

export async function reconcileOrderFulfillment(
  lasyncroOrderId: string,
  aggregateVersion: number,
  observed?: {
    status: 'fulfilled';
    observedAt: Date;
    source: 'shopify_sync';
  }
): Promise<{
  result: ReconciliationResult;
  affectedVariantIds: string[];
}> {

  return db.transaction(async (trx) => {

    /**
     * RECONCILIATION SNAPSHOT WRITE FLAG
     * ----------------------------------
     * Signals database triggers that reconciliation writes
     * are allowed in this transaction.
     *
     * Uses custom application namespace (app.*) because
     * PostgreSQL rejects unknown root parameters.
     */
    await trx.raw(`SET LOCAL "synchroflow.reconciliation" = 'true'`);

    const order = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .forUpdate()
      .first();

    if (!order) {
      /**
       * RECONCILIATION SAFETY GUARD
       * ----------------------------
       * Order missing under projection is a structural violation.
       * Fail fast to avoid silent data divergence.
       */
      throw new Error(
        `[RECONCILIATION_INVARIANT_VIOLATION] Order not found: ${lasyncroOrderId}`
      );
    }

    /**
     * RECONCILIATION MODE DETECTION
     * -----------------------------
     * Synthetic reconciliation occurs when projection has already
     * processed this aggregate version.
     *
     * IMPORTANT:
     * Operational snapshots MUST still be recomputed during rebuild
     * to guarantee deterministic reconstruction of operational state.
     */
    const syntheticMode =
      aggregateVersion !== order.aggregate_version ||
      aggregateVersion <= order.last_projected_version;

    await writeOrderRevenueUnits(lasyncroOrderId, trx);

    /**
     * SYNTHETIC MODE NOTICE
     * ---------------------
     * When syntheticMode = true:
     * - Skip mutation paths
     * - STILL compute operational snapshots
     *
     * This guarantees rebuild correctness.
     */
    if (syntheticMode) {
      console.debug('[RECONCILIATION_SYNTHETIC_MODE]', {
        order: lasyncroOrderId,
        aggregateVersion,
      });
    }

    /**
     * SNAPSHOT DATE (Event-Time Anchored)
     * -----------------------------------
     * Must be derived from deterministic domain event-time.
     *
     * Anchor Rule:
     * - Use max(order_updated_at, order_created_at)
     * - Never use wall-clock.
     *
     * Guarantees:
     * - Replay determinism
     * - Cross-node consistency
     * - No execution-time drift
     */

    /**
     * EVENT-TIME MATERIALIZATION RULE
     * --------------------------------
     * All projection timestamps MUST derive from eventAnchor.
     *
     * Forbidden inside reconciliation:
     * - trx.fn.now()
     * - Date.now()
     * - new Date() without anchor
     *
     * This preserves:
     * - Deterministic rebuilds
     * - Stable state hashing
     */
    const eventAnchor =
      order.order_updated_at ??
      order.order_created_at;

    if (!eventAnchor) {
      throw new Error(
        '[EVENT_TIME_VIOLATION] Order missing event-time anchor'
      );
    }

    /**
     * REFUND REPLAY SAFETY RESET
     * --------------------------
     * Reconciliation is replayable by design.
     * Refund resolution is additive.
     *
     * To ensure deterministic replay safety,
     * we MUST reset returned_quantity before re-applying
     * all refund_executions.
     *
     * This guarantees:
     * - No double application
     * - Deterministic structural revenue
     * - Correct inventory rebuild
     */
    
    /**
     * REFUND APPLICATION MODEL
     * ------------------------
     * Revenue units are immutable economic atoms.
     * Returned quantities are derived from
     * refund_execution_line_items.
     *
     * No mutation occurs here.
     */

    const refundExecutions = await trx('refund_executions')
      .where({ lasyncro_order_id: lasyncroOrderId });

    for (const execution of refundExecutions) {
      await resolveRefundExecution(
        execution.lasyncro_refund_execution_id,
        trx
      );
    }

    /**
     * DETERMINISTIC VARIANT EXTRACTION
     * --------------------------------
     * DISTINCT without ORDER BY produces unstable ordering.
     *
     * Variant ordering must be canonical to guarantee:
     * - deterministic rebuilds
     * - stable inventory projection rebuild order
     * - deterministic operational signal computation
     */
    const variantRows = await trx('order_revenue_units')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .distinct('lasyncro_variant_id')
      .orderBy('lasyncro_variant_id', 'asc');

    const affectedVariantIds = variantRows.map(r => r.lasyncro_variant_id);

    if (affectedVariantIds.length > 0) {
      await rebuildInventoryProjectionForVariants(
        order.shop_id,
        affectedVariantIds,
        trx
      );
    };

    /**
     * ENSURE FULFILLMENT STATE ROW
     * -----------------------------
     * Deterministic baseline row.
     */
    await trx('order_fulfillment_status')
      .insert({
        lasyncro_fulfillment_id: deterministicId(
          'order_fulfillment_status',
          lasyncroOrderId,
          aggregateVersion
        ),
        lasyncro_order_id: lasyncroOrderId,
        status: 'pending', // enum-aligned
        status_updated_at: new Date(eventAnchor),
        created_at: new Date(eventAnchor),
        updated_at: new Date(eventAnchor),
      })
      .onConflict('lasyncro_order_id')
      .ignore();

    await computeObligationFlagsForOrders(
      [lasyncroOrderId],
      trx
    );

    /**
     * ORDER RISK SNAPSHOT MATERIALIZATION
     * ------------------------------------
     * Replace-on-reconcile.
     * Deterministic.
     */
    const ofs = await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .first();

    const isInventoryBlocked = !!ofs?.inventory_block_type;
    const isCustomerBlocked = !!ofs?.customer_block_type;
    const isOperationalBlocked = !!ofs?.operational_block_type;

    /**
     * ORDER CONSTRAINT EVENT LIFECYCLE
     * ---------------------------------
     * Append-only event model.
     * Opens on detection.
     * Closes when cleared.
     */
    const constraintMap = {
      inventory: isInventoryBlocked,
      customer: isCustomerBlocked,
      operational: isOperationalBlocked,
    } as const;

    for (const [type, isActive] of Object.entries(constraintMap)) {

      const activeEvent = await trx('order_constraint_events')
        .where({
          lasyncro_order_id: lasyncroOrderId,
          constraint_type: type,
          is_active: true,
        })
        .first();

      if (isActive && !activeEvent) {
        // OPEN
        await trx('order_constraint_events').insert({
          constraint_event_id: deterministicId(
            `order_constraint_event:${type}`,
            lasyncroOrderId,
            aggregateVersion
          ),
          lasyncro_order_id: lasyncroOrderId,
          shop_id: order.shop_id,
          constraint_type: type,
          started_at: new Date(eventAnchor),
          resolved_at: null,
          is_active: true,
        });
      }

      if (!isActive && activeEvent) {
        // CLOSE
        await trx('order_constraint_events')
          .where({
            constraint_event_id: activeEvent.constraint_event_id,
          })
          .update({
            resolved_at: new Date(eventAnchor),
            is_active: false,
          });
      }
    }
    
    /**
     * PREDICTIVE RISK MODEL (RULE-BASED)
     * -----------------------------------
     * Deterministic heuristic model.
     * No ML, no randomness.
     */

    let fraudScore = 0;
    let returnProbability = 0;

    /**
     * Financial accumulators.
     * NOTE:
     * Gross margin and marginPct MUST be computed
     * only AFTER revenue aggregation loop.
     */
    let grossRevenue = 0;
    let estimatedCost = 0;

    // Defer margin computation until after aggregation.
    let grossMargin = 0;
    let marginPct = 0;

    if (isCustomerBlocked) fraudScore += 0.4;
    if (isInventoryBlocked) fraudScore += 0.1;
    if (isOperationalBlocked) fraudScore += 0.1;

    fraudScore = Math.min(fraudScore, 1);
    returnProbability = Math.min(returnProbability, 1);

    /**
     * ORDER MARGIN SNAPSHOT MATERIALIZATION
     * --------------------------------------
     * Replace-on-reconcile.
     * Derived from immutable revenue units.
     */
    const marginRows = await trx('order_revenue_units_net as runet')
      .join(
        'order_revenue_units as ru',
        'ru.lasyncro_revenue_unit_id',
        'runet.lasyncro_revenue_unit_id'
      )
      .where('runet.lasyncro_order_id', lasyncroOrderId)
      /**
       * DETERMINISTIC ROW ORDERING
       * ---------------------------
       * Aggregation loops MUST operate on a stable row order.
       * Postgres does not guarantee ordering without ORDER BY.
       *
       * We enforce ordering by revenue_unit_id to preserve
       * replay determinism and floating-point stability.
       */
      .orderBy('runet.lasyncro_revenue_unit_id', 'asc')
      .select(
        'runet.net_revenue',
        'runet.net_quantity',
        'ru.estimated_unit_cost',
        'ru.discount_amount',
        'ru.shipping_cost',
        'ru.payment_fee',
        'ru.fulfillment_cost'
      );

    for (const r of marginRows) {

      const revenue = Number(r.net_revenue ?? 0);
      const qty = Number(r.net_quantity ?? 0);
      const unitCost = Number(r.estimated_unit_cost ?? 0);

      const discount = Number(r.discount_amount ?? 0);
      const shipping = Number(r.shipping_cost ?? 0);
      const paymentFee = Number(r.payment_fee ?? 0);
      const fulfillmentCost = Number(r.fulfillment_cost ?? 0);

      if (Number.isFinite(revenue)) {
        grossRevenue += revenue;
      }

      if (Number.isFinite(qty) && Number.isFinite(unitCost)) {
        estimatedCost += qty * unitCost;
      }

      estimatedCost +=
        discount +
        shipping +
        paymentFee +
        fulfillmentCost;
    }

    /**
     * FINALIZED MARGIN COMPUTATION
     * -----------------------------
     * Must execute AFTER revenue + cost aggregation.
     * Ensures replay-safe deterministic financial truth.
     */
    grossMargin = grossRevenue - estimatedCost;

    marginPct =
      grossRevenue > 0
        ? grossMargin / grossRevenue
        : 0;
    
    /**
     * RETURN PROBABILITY — FINANCIAL DEPENDENCIES
     * --------------------------------------------
     * Must execute AFTER finalized margin computation.
     * Ensures deterministic correctness.
     */
    if (marginPct < 0.05) returnProbability += 0.3;
    if (grossRevenue > 1000) returnProbability += 0.2;

    // Clamp again after financial adjustments
    returnProbability = Math.min(returnProbability, 1);

    await trx('order_margin_snapshot')
      .insert({
        lasyncro_order_id: lasyncroOrderId,

        /**
         * PROJECTION VERSION (CRITICAL)
         * ------------------------------
         * Binds snapshot to exact aggregate_version
         * used during reconciliation.
         */
        aggregate_version: order.aggregate_version,

        shop_id: order.shop_id,
        gross_revenue: grossRevenue,
        estimated_cost: estimatedCost,
        gross_margin: grossMargin,
        margin_pct: marginPct,
        evaluated_at: new Date(eventAnchor),
      })
      .onConflict('lasyncro_order_id')
      .merge();

    /**
     * ORDER AGE SNAPSHOT MATERIALIZATION
     * -----------------------------------
     * Replace-on-reconcile.
     * Fully derived from canonical state.
     */
    const ofsAge = await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select('fulfilled_at')
      .first();

    /**
     * ECONOMIC FULFILLMENT PROPAGATION
     * --------------------------------
     * When an order is marked fulfilled we propagate the
     * fulfillment state to the economic ledger.
     *
     * Rationale:
     * - order_fulfillment_status = operational state
     * - order_revenue_units = economic ledger
     *
     * The ledger must reflect fulfillment so that:
     * - inventory reconciliation
     * - revenue realization
     * - refund allocation
     * remain correct.
     *
     * Deterministic rule:
     * If fulfilled_at exists → all units are fulfilled.
     */
    if (ofsAge?.fulfilled_at) {
      await trx('order_revenue_units')
        .where({ lasyncro_order_id: lasyncroOrderId })
        .update({
          fulfilled_quantity: trx.raw('quantity')
        });
    }

    /**
    * AGE CALCULATION CLOCK (Aggregate-State Anchored)
    * ------------------------------------------------
    * Use the order's canonical order_updated_at.
    * This value is projection-deterministic and
    * already reflects the latest domain event.
    */
   if (!order.order_updated_at) {
     throw new Error(
       '[AGE_INVARIANT_VIOLATION] order_updated_at missing during reconciliation'
     );
   }

    const now = new Date(order.order_updated_at);

    const createdAt = order.order_created_at
      ? new Date(order.order_created_at)
      : null;

    const paidAt = order.paid_at
      ? new Date(order.paid_at)
      : null;

    const fulfilledAt = ofsAge?.fulfilled_at
      ? new Date(ofsAge.fulfilled_at)
      : null;

    const promisedShipBy = order.promised_ship_by
      ? new Date(order.promised_ship_by)
      : null;

    const promisedDeliveryAt = order.promised_delivery_at
      ? new Date(order.promised_delivery_at)
      : null;

    console.log('[AGE_DEBUG]', {
      lasyncroOrderId,
      now,
      orderUpdatedAt: order.order_updated_at,
      fulfilledAt,
    });

    /**
     * AGE INVARIANT
     * -------------
     * Order creation event-time is mandatory.
     * Null here indicates structural violation.
     */
    if (!createdAt) {
      throw new Error(
        '[AGE_INVARIANT_VIOLATION] order_created_at missing during reconciliation'
      );
    }

    const rawAgeSinceCreation =
      Math.floor((now.getTime() - createdAt.getTime()) / 1000);

    if (rawAgeSinceCreation < 0) {
      console.error('[AGE_NEGATIVE_GUARD] creation age < 0', {
        lasyncroOrderId,
        eventAnchor,
        createdAt,
      });
    }

    const ageSinceCreation = Math.max(rawAgeSinceCreation, 0);

    /**
     * AGING BUCKETS (Paid Orders Only)
     * ---------------------------------
     * Buckets operate exclusively on age_since_paid_seconds.
     * Unpaid orders are excluded by design.
     *
     * If unpaid aging is required,
     * this query must be structurally expanded.
     */

    const rawAgeSincePaid =
      paidAt
        ? Math.floor((now.getTime() - paidAt.getTime()) / 1000)
        : null;

    if (rawAgeSincePaid !== null && rawAgeSincePaid < 0) {
      console.error('[AGE_NEGATIVE_GUARD] paid age < 0', {
        lasyncroOrderId,
        eventAnchor,
        paidAt,
      });
    }

    const ageSincePaid =
      rawAgeSincePaid !== null
        ? Math.max(rawAgeSincePaid, 0)
        : null;

    const rawAgeSinceFulfillment =
      fulfilledAt
        ? Math.floor((now.getTime() - fulfilledAt.getTime()) / 1000)
        : null;

    if (rawAgeSinceFulfillment !== null && rawAgeSinceFulfillment < 0) {
      console.error('[AGE_NEGATIVE_GUARD] fulfillment age < 0', {
        lasyncroOrderId,
        eventAnchor,
        fulfilledAt,
      });
    }

    const ageSinceFulfillment =
      rawAgeSinceFulfillment !== null
        ? Math.max(rawAgeSinceFulfillment, 0)
        : null;

    const isShippingSlaBreached =
      promisedShipBy && !fulfilledAt
        ? now > promisedShipBy
        : false;

    const isDeliverySlaBreached =
      promisedDeliveryAt && !fulfilledAt
        ? now > promisedDeliveryAt
        : false;
    
    /**
     * ORDER HEALTH SCORE CONTRACT (0–100)
     * ------------------------------------
     * Deterministic urgency model.
     *
     * Total score is capped at 100.
     * Each dimension has a fixed maximum allocation.
     *
     * DIMENSIONS:
     *
     * 1. SLA Escalation          → max 30
     * 2. Operational Blockers    → max 30
     * 3. Financial Urgency       → max 25
     * 4. Aging Escalation        → max 15
     *
     * TOTAL MAX = 100
     *
     * Invariants:
     * - No randomness
     * - No external dependencies
     * - Must remain replay-safe
     * - Any weight change requires version note
     */
    let healthScore = 0;

    /**
     * HEALTH SCORE COMPONENT ACCUMULATORS
     * -----------------------------------
     * These variables track the contribution of each scoring
     * factor so they can be persisted in order_risk_snapshot.
     */
    let agingRiskContribution = 0;
    let slaRiskContribution = 0;
    let inventoryRiskContribution = 0;
    let customerRiskContribution = 0;
    let operationalRiskContribution = 0;

    /* --- SLA Escalation (max 30) --- */
    if (isShippingSlaBreached) {
      slaRiskContribution += 20;
      healthScore += 20;
    }

    if (isDeliverySlaBreached) {
      slaRiskContribution += 10;
      healthScore += 10;
    }

    /* --- Operational Blocking Signals --- */
    if (isInventoryBlocked) {
      inventoryRiskContribution = 15;
      healthScore += inventoryRiskContribution;
    }

    if (isOperationalBlocked) {
      operationalRiskContribution = 10;
      healthScore += operationalRiskContribution;
    }

    if (isCustomerBlocked) {
      customerRiskContribution = 5;
      healthScore += customerRiskContribution;
    }

    if (grossMargin < 0) {
      slaRiskContribution += 15;
      healthScore += 15;
    }

    if (grossRevenue > 0) {
      const revenueScale = Math.min(grossRevenue / 5000, 1); 
      const revenueContribution = Math.round(revenueScale * 10);
      slaRiskContribution += revenueContribution;
      healthScore += revenueContribution;
    }

    /* --- Aging Escalation (max 15) --- */
    if (ageSincePaid && ageSincePaid > 0) {
      const days = ageSincePaid / 86400;
      const agingScale = Math.min(days / 7, 1);

      agingRiskContribution = Math.round(agingScale * 15);
      healthScore += agingRiskContribution;
    }

   /**
     * OPERATIONAL RISK THRESHOLD
     * --------------------------
     * Health score distribution (empirically observed):
     *
     *   0–2 → normal
     *   3–4 → elevated
     *   ≥5  → operational risk
     *
     * The scoring model currently produces values in
     * the approximate range 0–10.
     *
     * IMPORTANT:
     * If scoring weights are modified, this threshold
     * MUST be reviewed or risk detection will silently fail.
     */
    const isAtRisk = healthScore >= 5;

    /**
     * HEALTH SCORE INVARIANT
     * ----------------------
     * Hard guarantee: score must remain within 0–100.
     */
    if (healthScore < 0 || healthScore > 100) {
      throw new Error(
        '[HEALTH_SCORE_INVARIANT_VIOLATION] Score out of bounds'
      );
    }

    /**
     * ORDER RISK SNAPSHOT MATERIALIZATION
     * ------------------------------------
     * Must execute AFTER health score computation.
     * Replace-on-reconcile.
     */
    await trx('order_risk_snapshot')
      .insert({
        lasyncro_order_id: lasyncroOrderId,
        aggregate_version: order.aggregate_version,
        shop_id: order.shop_id,

        is_inventory_blocked: isInventoryBlocked,
        is_customer_blocked: isCustomerBlocked,
        is_operational_blocked: isOperationalBlocked,
        is_at_risk: isAtRisk,

        fraud_score: fraudScore,
        return_probability: returnProbability,

        /**
         * HEALTH SCORE SNAPSHOT
         * ---------------------
         * The final computed health score used for
         * operational prioritization.
         */
        order_health_score: healthScore,

        /**
         * HEALTH SCORE COMPONENT SNAPSHOT
         * --------------------------------
         * Persist the contribution of each risk factor
         * so the scoring model is fully auditable.
         */
        aging_risk_component: agingRiskContribution,
        sla_risk_component: slaRiskContribution,
        inventory_risk_component: inventoryRiskContribution,
        customer_risk_component: customerRiskContribution,
        operational_risk_component: operationalRiskContribution,

        evaluated_at: new Date(eventAnchor),
      })
      .onConflict('lasyncro_order_id')
      .merge();

    await trx('order_age_snapshot')
      .insert({
        lasyncro_order_id: lasyncroOrderId,

        /**
         * PROJECTION VERSION (CRITICAL)
         * ------------------------------
         * Snapshot must bind to exact aggregate_version
         * used during reconciliation.
         */
        aggregate_version: order.aggregate_version,

        age_since_creation_seconds: ageSinceCreation,
        age_since_paid_seconds: ageSincePaid,
        age_since_fulfillment_seconds: ageSinceFulfillment,

        is_shipping_sla_breached: isShippingSlaBreached,
        is_delivery_sla_breached: isDeliverySlaBreached,

        snapshot_generated_at: new Date(eventAnchor),
      })
      .onConflict('lasyncro_order_id')
      .merge();

    /**
     * DAILY REVENUE PROJECTION MATERIALIZATION
     * -----------------------------------------
     * Replace per (shop_id, revenue_date).
     * Derived from net revenue + risk snapshot.
     */

    const orderDateRow = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select('order_created_at')
      .first();

    if (orderDateRow?.order_created_at) {
      const revenueDate = new Date(orderDateRow.order_created_at)
        .toISOString()
        .split('T')[0];

      const dailyRows = await trx('order_revenue_units_net as runet')
        .join(
          'orders as o',
          'o.lasyncro_order_id',
          'runet.lasyncro_order_id'
        )
        .leftJoin(
          'order_risk_snapshot as ors',
          'ors.lasyncro_order_id',
          'runet.lasyncro_order_id'
        )
        .where('o.shop_id', order.shop_id)
        .andWhereRaw('DATE(o.order_created_at) = ?', [revenueDate])
        .groupByRaw('DATE(o.order_created_at)')
         /**
         * DETERMINISTIC GROUP RESULT ORDERING
         * -----------------------------------
         * GROUP BY does not guarantee row order.
         * Stable ordering is required for replay hashing.
         */
        .orderByRaw('DATE(o.order_created_at) ASC')
        .select(
          trx.raw('SUM(runet.net_revenue) as gross_revenue'),
          trx.raw('COUNT(DISTINCT o.lasyncro_order_id) as order_count'),
          trx.raw(`
            SUM(
              CASE
                WHEN ors.is_at_risk = true
                THEN runet.net_revenue
                ELSE 0
              END
            ) as at_risk_revenue
          `)
        )
        .first();

      await trx('revenue_projection_daily')
        .insert({
          shop_id: order.shop_id,
          revenue_date: revenueDate,
          gross_revenue: Number(dailyRows?.gross_revenue ?? 0),
          order_count: Number(dailyRows?.order_count ?? 0),
          at_risk_revenue: Number(dailyRows?.at_risk_revenue ?? 0),
          evaluated_at: new Date(eventAnchor),
        })
        .onConflict(['shop_id', 'revenue_date'])
        .merge();
    }

    const briefDate = new Date(eventAnchor)
      .toISOString()
      .split('T')[0];

    /* --- Critical Orders (healthScore >= 70) --- */
    const criticalOrders = await trx('order_risk_snapshot')
      .where('shop_id', order.shop_id)
      .andWhere('order_health_score', '>=', 70)
      .count<{ count: string }>('lasyncro_order_id as count')
      .first();

    /* --- Negative Margin Orders --- */
    const negativeMarginOrders = await trx('order_margin_snapshot')
      .where('shop_id', order.shop_id)
      .andWhere('gross_margin', '<', 0)
      .count<{ count: string }>('lasyncro_order_id as count')
      .first();

    /* --- SLA Breached Orders --- */
    const slaBreachedOrders = await trx('order_age_snapshot')
      .whereIn('lasyncro_order_id',
        trx('orders')
          .where('shop_id', order.shop_id)
          .select('lasyncro_order_id')
      )
      .andWhere(function () {
        this.where('is_shipping_sla_breached', true)
            .orWhere('is_delivery_sla_breached', true);
      })
      .count<{ count: string }>('lasyncro_order_id as count')
      .first();

    /* --- Inventory Blocked Revenue --- */
    const inventoryBlockedRevenue = await trx('order_revenue_units_net as runet')
      .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'runet.lasyncro_order_id')
      .where('ors.shop_id', order.shop_id)
      .andWhere('ors.is_inventory_blocked', true)
      .sum<{ sum: string }>('runet.net_revenue as sum')
      .first();

    /* --- Cash Realized Today --- */
    const cashToday = await trx('orders')
      .where('shop_id', order.shop_id)
      .andWhereRaw('DATE(captured_at) = ?', [briefDate])
      .sum<{ sum: string }>('total_price as sum')
      .first();

    /**
     * REFUND EXPOSURE
     * ----------------
     * Placeholder until refund projection layer exists.
     *
     * IMPORTANT:
     * Refund exposure MUST represent financial liability from
     * returned or refunded items — not operational risk.
     *
     * Previous implementation incorrectly reused at-risk revenue.
     * That created semantic duplication with `at_risk_revenue`.
     */
    const refundExposure = { sum: 0 };

    /**
     * TOP 10 PRIORITY ORDERS
     * -----------------------
     * Deterministic ordering:
     * 1. Health score DESC
     * 2. Shipping SLA breach DESC
     * 3. Gross margin ASC (worse margin first)
     * 4. Age since paid DESC
     * 5. Stable UUID ASC (final deterministic stabilizer)
     */
    const topPriorityOrders = await trx('order_risk_snapshot as ors')
      .join('order_age_snapshot as oas', 'oas.lasyncro_order_id', 'ors.lasyncro_order_id')
      .join('order_margin_snapshot as oms', 'oms.lasyncro_order_id', 'ors.lasyncro_order_id')
      .where('ors.shop_id', order.shop_id)
      .orderBy([
        { column: 'ors.order_health_score', order: 'desc' },
        { column: 'oas.is_shipping_sla_breached', order: 'desc' },
        { column: 'oms.gross_margin', order: 'asc' },
        { column: 'oas.age_since_paid_seconds', order: 'desc' },
        { column: 'ors.lasyncro_order_id', order: 'asc' },
      ])
      .limit(10)
      .pluck('ors.lasyncro_order_id');

    await trx('daily_operational_brief_snapshot')
      .insert({
        shop_id: order.shop_id,
        brief_date: briefDate,
        critical_orders_count: Number(criticalOrders?.count ?? 0),
        negative_margin_orders_count: Number(negativeMarginOrders?.count ?? 0),
        sla_breached_count: Number(slaBreachedOrders?.count ?? 0),
        inventory_blocked_revenue: Number(inventoryBlockedRevenue?.sum ?? 0),
        cash_realized_today: Number(cashToday?.sum ?? 0),
        refund_exposure: Number(refundExposure?.sum ?? 0),
        top_10_priority_order_ids: JSON.stringify(topPriorityOrders ?? []),
        evaluated_at: new Date(eventAnchor),
      })
      .onConflict(['shop_id', 'brief_date'])
      .merge();

      /**
       * PENDING PAYMENT
       * ---------------
       * Definition:
       * - payment_state = 'unpaid'
       * - No captured_at timestamp
       *
       * Strictly financial state.
       * No inference.
       */
      const pendingPaymentRow = await trx('orders')
        .where('shop_id', order.shop_id)
        .andWhere('payment_state', 'unpaid')
        .whereNull('captured_at')
        .count<{ count: string }>('lasyncro_order_id as count')
        .first();
      
      /**
       * ORDERS OPERATIONAL CONTROL SNAPSHOT
       * ------------------------------------
       * Phase 1 Control Tower materialization.
       *
       * Replace-on-reconcile.
       * Shop-level compression across:
       * - Revenue Integrity
       * - Order Health
       * - Constraint Intelligence
       * - Work Queues
       *
       * Must remain deterministic and replay-safe.
       */

      const snapshotDate = briefDate;

      /* ─────────────────────────────
        REVENUE INTEGRITY
      ───────────────────────────── */

      const realizedRevenueRow = await trx('orders')
        .where('shop_id', order.shop_id)
        .whereNotNull('captured_at')
        .sum<{ sum: string }>('total_price as sum')
        .first();

      const atRiskRevenueRow = await trx('order_revenue_units_net as runet')
        .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'runet.lasyncro_order_id')
        .where('ors.shop_id', order.shop_id)
        .andWhere('ors.is_at_risk', true)
        .sum<{ sum: string }>('runet.net_revenue as sum')
        .first();

      const blockedRevenueRow = await trx('order_revenue_units_net as runet')
        .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'runet.lasyncro_order_id')
        .where('ors.shop_id', order.shop_id)
        .andWhere(function () {
          this.where('ors.is_inventory_blocked', true)
              .orWhere('ors.is_operational_blocked', true)
              .orWhere('ors.is_customer_blocked', true);
        })
        .sum<{ sum: string }>('runet.net_revenue as sum')
        .first();

      /**
       * Pending Revenue
       * ----------------
       * Revenue attached to orders that are NOT fulfilled.
       *
       * Definition:
       * pending_revenue =
       *   SUM(net_revenue)
       *   WHERE fulfillment_status != 'fulfilled'
       *
       * IMPORTANT:
       * - Independent of risk model
       * - Derived strictly from fulfillment state
       * - Must remain deterministic for rebuild replay
       */
      const pendingRevenueRow = await trx('order_revenue_units_net as runet')
        .join(
          'order_fulfillment_status as ofs',
          'ofs.lasyncro_order_id',
          'runet.lasyncro_order_id'
        )
        .join(
          'orders as o',
          'o.lasyncro_order_id',
          'runet.lasyncro_order_id'
        )
        .where('o.shop_id', order.shop_id)
        .andWhereNot('ofs.status', 'fulfilled')
        .sum<{ sum: string }>('runet.net_revenue as sum')
        .first();

      const avgMarginRow = await trx('order_margin_snapshot')
        .where('shop_id', order.shop_id)
        .avg<{ avg: string }>('margin_pct as avg')
        .first();

      /* ─────────────────────────────
        ORDER HEALTH
      ───────────────────────────── */

      const ordersAtSlaRisk = Number(slaBreachedOrders?.count ?? 0);

      /**
       * AGING BUCKETS (STRICT OPERATIONAL BACKLOG)
       * -------------------------------------------
       * Includes ONLY:
       * - payment_state = 'paid'
       * - unfulfilled orders
       * - non-null age_since_paid_seconds
       *
       * Explicit guards prevent semantic drift.
       */
      const agingBuckets = await trx('order_age_snapshot as oas')
        .join('orders as o', 'o.lasyncro_order_id', 'oas.lasyncro_order_id')
        .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'oas.lasyncro_order_id')
        .where('o.shop_id', order.shop_id)
        .andWhere('o.payment_state', 'paid')
        .andWhere('ofs.status', 'pending')
        .whereNotNull('oas.age_since_paid_seconds')
        .select(
          trx.raw(`
            COUNT(*) FILTER (
              WHERE oas.age_since_paid_seconds >= 86400
              AND oas.age_since_paid_seconds < 172800
            ) as aging_24h
          `),
          trx.raw(`
            COUNT(*) FILTER (
              WHERE oas.age_since_paid_seconds >= 172800
              AND oas.age_since_paid_seconds < 259200
            ) as aging_48h
          `),
          trx.raw(`
            COUNT(*) FILTER (
              WHERE oas.age_since_paid_seconds >= 259200
            ) as aging_72h_plus
          `)
        )
        .first();

      /**
       * Constrained Orders (authoritative)
       * ----------------------------------
       * Derived from order_risk_snapshot.
       * Must not depend on FT2 resolver variables.
       */
      const constrainedOrdersRow = await trx('order_risk_snapshot')
        .where('shop_id', order.shop_id)
        .andWhere(function () {
          this.where('is_inventory_blocked', true)
              .orWhere('is_operational_blocked', true)
              .orWhere('is_customer_blocked', true);
        })
        .count<{ count: string }>('lasyncro_order_id as count')
        .first();

      const constrainedOrdersCount =
        Number(constrainedOrdersRow?.count ?? 0);

      const inventoryBlockedRevenueRow = inventoryBlockedRevenue;

      const customerBlockedRevenueRow = await trx('order_revenue_units_net as runet')
        .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'runet.lasyncro_order_id')
        .where('ors.shop_id', order.shop_id)
        .andWhere('ors.is_customer_blocked', true)
        .sum<{ sum: string }>('runet.net_revenue as sum')
        .first();

      const operationalBlockedRevenueRow = await trx('order_revenue_units_net as runet')
        .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'runet.lasyncro_order_id')
        .where('ors.shop_id', order.shop_id)
        .andWhere('ors.is_operational_blocked', true)
        .sum<{ sum: string }>('runet.net_revenue as sum')
        .first();

      /* ─────────────────────────────
        WORK QUEUES (Deterministic)
      ───────────────────────────── */

      /**
       * MANUAL REVIEW QUEUE (STRICT)
       * -----------------------------
       * Includes ONLY:
       * - fraud_score IS NOT NULL
       * - fraud_score > 0.8
       *
       * Explicit NULL guard prevents silent semantic drift.
       */
      const queueManualReview = await trx('order_risk_snapshot')
        .where('shop_id', order.shop_id)
        .whereNotNull('fraud_score')
        .andWhere('fraud_score', '>', 0.8)
        .count<{ count: string }>('lasyncro_order_id as count')
        .first();

      const queueAwaitingInventory = await trx('order_risk_snapshot')
        .where('shop_id', order.shop_id)
        .andWhere('is_inventory_blocked', true)
        .count<{ count: string }>('lasyncro_order_id as count')
        .first();

      /**
       * EXCEPTION ORDERS
       * ----------------
       * Definition (strict):
       * - Any at-risk flag
       * - Any active constraint
       * - Any SLA breach
       *
       * No health-score thresholds.
       * Pure state-based abnormality detection.
       */
      const exceptionOrdersRow = await trx('order_risk_snapshot as ors')
        .join('order_age_snapshot as oas', 'oas.lasyncro_order_id', 'ors.lasyncro_order_id')
        .where('ors.shop_id', order.shop_id)
        .andWhere(function () {
          this.where('ors.is_at_risk', true)
              .orWhere('ors.is_inventory_blocked', true)
              .orWhere('ors.is_customer_blocked', true)
              .orWhere('ors.is_operational_blocked', true)
              .orWhere('oas.is_shipping_sla_breached', true)
              .orWhere('oas.is_delivery_sla_breached', true);
        })
        .count<{ count: string }>('ors.lasyncro_order_id as count')
        .first();

      /**
       * READY-TO-SHIP QUEUE
       * --------------------
       * Definition (strict):
       * - Fulfillment status = pending
       * - No active inventory, customer, or operational blocks
       *
       * This explicitly separates:
       *   pending + blocked   → constrained
       *   pending + no blocks → ready to ship
       *
       * Deterministic.
       */
      const queueReadyToShip = await trx('order_fulfillment_status as ofs')
        .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
        .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'ofs.lasyncro_order_id')
        .where('o.shop_id', order.shop_id)
        .andWhere('ofs.status', 'pending')
        .andWhere('ors.is_inventory_blocked', false)
        .andWhere('ors.is_customer_blocked', false)
        .andWhere('ors.is_operational_blocked', false)
        .count<{ count: string }>('ofs.lasyncro_order_id as count')
        .first();

      const queueAwaitingCustomer = await trx('order_risk_snapshot')
        .where('shop_id', order.shop_id)
        .andWhere('is_customer_blocked', true)
        .count<{ count: string }>('lasyncro_order_id as count')
        .first();

      /**
       * PARTIAL FULFILLMENT OPPORTUNITY
       * -------------------------------
       * Orders containing both:
       * - available inventory
       * - blocked inventory items
       *
       * These orders can ship partially while
       * backordering unavailable SKUs.
       *
       * Deterministic rule:
       * inventory_block_type = 'partial'
       */
      const partialFulfillmentOpportunity = await trx('order_fulfillment_status as ofs')
        .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
        .where('o.shop_id', order.shop_id)
        .andWhere('ofs.inventory_block_type', 'partial')
        .count<{ count: string }>('ofs.lasyncro_order_id as count')
        .first();

      /**
       * REVENUE LEAKAGE (DETERMINISTIC)
       * --------------------------------
       * Leakage is defined as net revenue attached to
       * terminally cancelled fulfillments.
       *
       * Guarded by explicit fulfillment status check.
       *
       * If cancellation semantics expand,
       * this query must be version-reviewed.
       */
      const revenueLeakageRow = await trx('order_revenue_units_net as runet')
        .join('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'runet.lasyncro_order_id')
        .join('orders as o', 'o.lasyncro_order_id', 'runet.lasyncro_order_id')
        .where('o.shop_id', order.shop_id)
        .andWhere('ofs.status', 'cancelled')
        .sum<{ sum: string }>('runet.net_revenue as sum')
        .first();

      const revenueLeakage = Number(revenueLeakageRow?.sum ?? 0);

      if (revenueLeakage < 0) {
        throw new Error('[REVENUE_LEAKAGE_INVARIANT] Leakage cannot be negative');
      }

      await trx('orders_operational_control_snapshot')
        .insert({
          shop_id: order.shop_id,
          snapshot_date: snapshotDate,

          /**
           * PROJECTION VERSION (CRITICAL)
           * ------------------------------
           * Binds shop-level compression snapshot
           * to exact aggregate_version.
           */
          aggregate_version: order.aggregate_version,

          realized_revenue: Number(realizedRevenueRow?.sum ?? 0),
          at_risk_revenue: Number(atRiskRevenueRow?.sum ?? 0),
          blocked_revenue: Number(blockedRevenueRow?.sum ?? 0),
          pending_revenue: Number(pendingRevenueRow?.sum ?? 0),
          
          /**
           * REVENUE LEAKAGE
           * ---------------
           * Defined as irreversible revenue destruction
           * (e.g. cancelled or failed fulfillment).
           *
           * Current system has no such terminal states present.
           * Refunds are already netted in revenue units.
           *
           * Therefore leakage = 0.
           *
           * If future statuses introduce terminal loss states,
           * this must be recalculated deterministically.
           */
          revenue_leakage: revenueLeakage,
          avg_contribution_margin_pct: Number(avgMarginRow?.avg ?? 0),

          orders_at_sla_risk: ordersAtSlaRisk,
          aging_24h: Number((agingBuckets as any)?.aging_24h ?? 0),
          aging_48h: Number((agingBuckets as any)?.aging_48h ?? 0),

          aging_72h_plus: Number((agingBuckets as any)?.aging_72h_plus ?? 0),
          /**
           * Pending Fulfillment
           * -------------------
           * Orders not yet fulfilled.
           * Derived from order_fulfillment_status.
           */
          pending_fulfillment: Number(
            (
              await trx('order_fulfillment_status as ofs')
                .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
                .where('o.shop_id', order.shop_id)
                .andWhereNot('ofs.status', 'fulfilled')
                .count<{ count: string }>('ofs.lasyncro_order_id as count')
                .first()
            )?.count ?? 0
          ),

          pending_payment: Number(pendingPaymentRow?.count ?? 0),
          exception_orders: Number(exceptionOrdersRow?.count ?? 0),

          constrained_orders: constrainedOrdersCount,
          revenue_blocked_inventory: Number(inventoryBlockedRevenueRow?.sum ?? 0),
          revenue_blocked_customer: Number(customerBlockedRevenueRow?.sum ?? 0),
          revenue_blocked_operational: Number(operationalBlockedRevenueRow?.sum ?? 0),

          queue_manual_review: Number(queueManualReview?.count ?? 0),
          queue_awaiting_inventory: Number(queueAwaitingInventory?.count ?? 0),
          queue_ready_to_ship: Number(queueReadyToShip?.count ?? 0),
          queue_awaiting_customer: Number(queueAwaitingCustomer?.count ?? 0),

          /**
           * Partial fulfillment opportunity
           */
          partial_fulfillment_opportunity: Number(
            partialFulfillmentOpportunity?.count ?? 0
          ),

          evaluated_at: new Date(eventAnchor),
        })
        .onConflict(['shop_id', 'snapshot_date'])
        .merge();

    /**
     * PROJECTION AUDIT WRITE (IMMUTABLE)
     * -----------------------------------
     * Records successful projection at exact aggregate_version.
     *
     * Must execute inside same transaction to ensure:
     * - Atomicity
     * - Replay correctness
     * - No phantom projections
     */
    await trx('order_projection_audit_log').insert({
      lasyncro_order_id: lasyncroOrderId,
      aggregate_version: order.aggregate_version,
      source: 'reconciliation_worker',
    });

    await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        /**
         * RECONCILIATION MARKER (Event-Time Anchored)
         * --------------------------------------------
         * Must align with domain event-time to preserve
         * deterministic delta gate semantics.
         */
        last_projected_version: order.aggregate_version,
      });

    return {
      result: observed?.status === 'fulfilled' ? 'observed' : 'synthetic',
      affectedVariantIds,
    };
  });
}