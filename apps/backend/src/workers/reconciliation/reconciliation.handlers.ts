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
    let grossRevenue = 0;
    let estimatedCost = 0;
    const grossMargin = grossRevenue - estimatedCost;

    const marginPct =
      grossRevenue > 0
        ? grossMargin / grossRevenue
        : 0;

    if (isCustomerBlocked) fraudScore += 0.4;
    if (isInventoryBlocked) fraudScore += 0.1;
    if (isOperationalBlocked) fraudScore += 0.1;

    if (marginPct < 0.05) returnProbability += 0.3;
    if (grossRevenue > 1000) returnProbability += 0.2;

    fraudScore = Math.min(fraudScore, 1);
    returnProbability = Math.min(returnProbability, 1);

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
        evaluated_at: trx.fn.now(),
      })
      .onConflict('lasyncro_order_id')
      .merge();

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