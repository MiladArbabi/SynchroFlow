// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
import db from 'api-src/db';
import { ReconciliationResult } from './reconciliation.types';
import { writeOrderRevenueUnits } from './revenue-units.writer';
import { resolveRefundExecution } from 'api-src/workers/refundResolution.worker';
import { evaluateCustomerObligations } from
  'api-src/services/order-execution-intelligence/customerObligation.evaluator';
import { resolveRefundLineItemIdentity } from '../refund-line-item.resolver';

type ObservedExecution = {
  status: 'delivered';
  received_at: Date;
};

export async function reconcileOrderFulfillment(
  canonicalOrderId: string,
  observed?: {
    status: 'delivered';
    observedAt: Date;
    source: 'shopify_sync';
  }
): Promise<ReconciliationResult> {

  // Fetch canonical order
  const order = await db('canonical_orders')
    .where({ canonical_order_id: canonicalOrderId })
    .first();

  /* console.log('[RECON][DEBUG] lookup', {
    canonicalOrderId,
    found: !!order,
    row: order ?? null,
  }); */

  if (!order) {
    // Hard stop — invalid input
    throw new Error(`Canonical order not found: ${canonicalOrderId}`);
  }

  // Observed execution from sync or webhook ALWAYS wins
  if (observed?.status === 'delivered') {
    await db('order_fulfillment_status')
      .insert({
        canonical_order_id: canonicalOrderId,
        shop_id: order.shop_id,
        order_id: order.platform_order_id,
        status: 'delivered',
        status_updated_at: observed.observedAt,
        execution_source: 'observed',
        execution_confidence: 'certain',
      })
      .onConflict(['shop_id', 'canonical_order_id'])
      .merge({
        status: 'delivered',
        status_updated_at: observed.observedAt,
        execution_source: 'observed',
        execution_confidence: 'certain',
      });

    return 'observed';
  }

  // Check existing execution
  const existing = await db('order_fulfillment_status')
    .where({ canonical_order_id: canonicalOrderId })
    .first();

  if (existing && existing.execution_source === 'observed') {
    return 'noop';
  }

  if (existing && existing.execution_source === 'synthetic') {
    await db('order_fulfillment_status')
        .where({ canonical_order_id: canonicalOrderId })
        .delete();
  }

  // 3. Insert synthetic execution
  await db('order_fulfillment_status').insert({
    canonical_order_id: order.canonical_order_id,
    order_id: order.platform_order_id,
    shop_id: order.shop_id,

    status: 'processing',
    status_updated_at: order.order_created_at,

    execution_source: 'synthetic',
    execution_confidence: 'assumed',
    /* synthetic_reason: 'missing_fulfillment_execution', */
    // synthetic_created_at intentionally omitted
  });

  // 4. Materialize revenue units (Customer Obligation v3 boundary)
  await writeOrderRevenueUnits(order.shop_id, order.canonical_order_id);

  // 🔁 Re-apply refund effects now that revenue units exist
  const appliedRefunds = await db('refund_executions')
    .where({
      canonical_order_id: order.canonical_order_id,
    });

  for (const execution of appliedRefunds) {
    await resolveRefundExecution(execution.id);
  }

  /**
   * Refund Resolution Boundary
   * -------------------------
   * Apply all refund executions that were deferred
   * due to missing canonical order identity.
   */
  const refundExecutions = await db('refund_executions')
    .where({
      platform_order_id: order.platform_order_id,
    });

  for (const execution of refundExecutions) {
    if (!execution.canonical_order_id) {
      // Terminally non-applicable refund
      await db('refund_executions')
        .where({ id: execution.id })
        .update({
          execution_status: 'voided',
        });

      continue;
    }

    // Backfill linkage
    await db('refund_execution_line_items')
      .where({ refund_execution_id: execution.id })
      .update({
        canonical_order_id: execution.canonical_order_id,
      });

    // Identity resolution
    await resolveRefundLineItemIdentity(execution.id);

    // Derived effects
    await resolveRefundExecution(execution.id);
  }

  // Customer Obligation v3 — explicit evaluation boundary
  await evaluateCustomerObligations(order.shop_id);

  return 'synthetic';
}