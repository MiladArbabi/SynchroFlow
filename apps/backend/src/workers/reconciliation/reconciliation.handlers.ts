// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
import db from '@lasyncro/backend-core/db.js';
import { ReconciliationResult } from './reconciliation.types.js';
import { writeOrderRevenueUnits } from './revenue-units.writer.js';
import { resolveRefundExecution } from '../refundResolution.worker.js';
import { rebuildInventoryProjectionForVariants } from '../../services/inventory/rebuildInventoryProjection.js';
import { computeObligationFlagsForOrders } from '../../services/order-execution-intelligence/obligationFlags.worker.js';

export async function reconcileOrderFulfillment(
  lasyncroOrderId: string,
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

    const order = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .forUpdate()
      .first();

    if (!order) {
      throw new Error(`Order not found: ${lasyncroOrderId}`);
    }

    await writeOrderRevenueUnits(lasyncroOrderId, trx);

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

    const variantRows = await trx('order_revenue_units')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .distinct('lasyncro_variant_id');

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
        lasyncro_fulfillment_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status: 'pending', // enum-aligned
        status_updated_at: trx.fn.now(),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
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

    const isAtRisk =
      isInventoryBlocked ||
      isCustomerBlocked ||
      isOperationalBlocked;

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
          constraint_event_id: crypto.randomUUID(),
          lasyncro_order_id: lasyncroOrderId,
          shop_id: order.shop_id,
          constraint_type: type,
          started_at: trx.fn.now(),
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
            resolved_at: trx.fn.now(),
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
        shop_id: order.shop_id,
        gross_revenue: grossRevenue,
        estimated_cost: estimatedCost,
        gross_margin: grossMargin,
        margin_pct: marginPct,
        evaluated_at: trx.fn.now(),
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

    const now = new Date();

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

    const ageSinceCreation =
      createdAt
        ? Math.floor((now.getTime() - createdAt.getTime()) / 1000)
        : 0;

    const ageSincePaid =
      paidAt
        ? Math.floor((now.getTime() - paidAt.getTime()) / 1000)
        : null;

    const ageSinceFulfillment =
      fulfilledAt
        ? Math.floor((now.getTime() - fulfilledAt.getTime()) / 1000)
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
     * ORDER HEALTH SCORE (0–100)
     * ---------------------------
     * Semantic Contract:
     * Measures immediate operational + financial urgency.
     *
     * Components:
     * - SLA breach escalation
     * - Hard operational blockers
     * - Negative margin penalty
     * - Revenue exposure scaling
     * - Aging pressure (paid but unfulfilled)
     *
     * Deterministic. Replay-safe.
     */
    let healthScore = 0;

    /* --- SLA Escalation (max 30) --- */
    if (isShippingSlaBreached) healthScore += 20;
    if (isDeliverySlaBreached) healthScore += 10;

    /* --- Hard Operational Blockers (max 30) --- */
    if (isInventoryBlocked) healthScore += 15;
    if (isOperationalBlocked) healthScore += 10;
    if (isCustomerBlocked) healthScore += 5;

    /* --- Financial Urgency (max 25) --- */
    if (grossMargin < 0) healthScore += 15;

    if (grossRevenue > 0) {
      const revenueScale = Math.min(grossRevenue / 5000, 1); 
      healthScore += Math.round(revenueScale * 10);
    }

    /* --- Aging Escalation (max 15) --- */
    if (ageSincePaid && ageSincePaid > 0) {
      const days = ageSincePaid / 86400;
      const agingScale = Math.min(days / 7, 1); 
      healthScore += Math.round(agingScale * 15);
    }

    /* Clamp to 0–100 */
    healthScore = Math.min(Math.max(healthScore, 0), 100);

    /**
     * ORDER RISK SNAPSHOT MATERIALIZATION
     * ------------------------------------
     * Must execute AFTER health score computation.
     * Replace-on-reconcile.
     */
    await trx('order_risk_snapshot')
      .insert({
        lasyncro_order_id: lasyncroOrderId,
        shop_id: order.shop_id,
        is_inventory_blocked: isInventoryBlocked,
        is_customer_blocked: isCustomerBlocked,
        is_operational_blocked: isOperationalBlocked,
        is_at_risk: isAtRisk,
        fraud_score: fraudScore,
        return_probability: returnProbability,
        order_health_score: healthScore,
        evaluated_at: trx.fn.now(),
      })
      .onConflict('lasyncro_order_id')
      .merge();

    await trx('order_age_snapshot')
      .insert({
        lasyncro_order_id: lasyncroOrderId,
        age_since_creation_seconds: ageSinceCreation,
        age_since_paid_seconds: ageSincePaid,
        age_since_fulfillment_seconds: ageSinceFulfillment,
        is_shipping_sla_breached: isShippingSlaBreached,
        is_delivery_sla_breached: isDeliverySlaBreached,
        snapshot_generated_at: trx.fn.now(),
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
          evaluated_at: trx.fn.now(),
        })
        .onConflict(['shop_id', 'revenue_date'])
        .merge();
    }

    /**
     * DAILY OPERATIONAL BRIEF MATERIALIZATION
     * ----------------------------------------
     * Replace per (shop_id, brief_date).
     * Deterministic cross-order compression layer.
     */
    const briefDate = new Date().toISOString().split('T')[0];

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

    /* --- Refund Exposure (at-risk revenue) --- */
    const refundExposure = await trx('order_revenue_units_net as runet')
      .join('order_risk_snapshot as ors', 'ors.lasyncro_order_id', 'runet.lasyncro_order_id')
      .where('ors.shop_id', order.shop_id)
      .andWhere('ors.is_at_risk', true)
      .sum<{ sum: string }>('runet.net_revenue as sum')
      .first();

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
        evaluated_at: trx.fn.now(),
      })
      .onConflict(['shop_id', 'brief_date'])
      .merge();

    await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        last_reconciled_at: trx.fn.now(),
      });

    return {
      result: observed?.status === 'fulfilled' ? 'observed' : 'synthetic',
      affectedVariantIds,
    };
  });
}