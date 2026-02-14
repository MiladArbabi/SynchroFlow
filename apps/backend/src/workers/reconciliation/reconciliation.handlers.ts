// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
import db from 'api-src/db';
import { ReconciliationResult } from './reconciliation.types';
import { writeOrderRevenueUnits } from './revenue-units.writer';
import { resolveRefundExecution } from 'api-src/workers/refundResolution.worker';
import { evaluateCustomerObligations } from
  'api-src/services/order-execution-intelligence/customerObligation.evaluator';

export async function reconcileOrderFulfillment(
  lasyncroOrderId: string,
  observed?: {
    status: 'fulfilled';
    observedAt: Date;
    source: 'shopify_sync';
  }
): Promise<ReconciliationResult> {

  // 1. Fetch sovereign order
  const order = await db('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .first();

  if (!order) {
    throw new Error(`Order not found: ${lasyncroOrderId}`);
  }

  // 2. Observed execution wins
  if (observed?.status === 'fulfilled') {
    await db('order_fulfillment_status')
      .insert({
        lasyncro_fulfillment_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status: 'fulfilled',
        status_updated_at: observed.observedAt,
      })
      .onConflict(['lasyncro_order_id'])
      .merge({
        status: 'fulfilled',
        status_updated_at: observed.observedAt,
      });

    // ALWAYS materialize revenue units
    await writeOrderRevenueUnits(lasyncroOrderId);

    return 'observed';
  }

  // 3. Check existing execution
  const existing = await db('order_fulfillment_status')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .first();

  // Revenue units must always be materialized once order exists
  await writeOrderRevenueUnits(lasyncroOrderId);

  if (existing) {
    return 'noop';
  }

  // 4. Insert synthetic execution
  await db('order_fulfillment_status')
    .insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: lasyncroOrderId,
      status: 'processing',
      status_updated_at: order.order_created_at,
    })
    .onConflict(['lasyncro_order_id'])
    .ignore();

  // 5. Materialize revenue units
  await writeOrderRevenueUnits(lasyncroOrderId);

  // 6. Apply refund executions
  const refundExecutions = await db('refund_executions')
    .where({ lasyncro_order_id: lasyncroOrderId });

  for (const execution of refundExecutions) {
    await resolveRefundExecution(execution.lasyncro_refund_execution_id);
  }

  // 7. Evaluate customer obligations
  await evaluateCustomerObligations(order.shop_id);

  return 'synthetic';
}
