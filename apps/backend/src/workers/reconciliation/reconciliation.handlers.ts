// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
import db from '@lasyncro/backend-core/db.js';
import { ReconciliationResult } from './reconciliation.types.js';
import { writeOrderRevenueUnits } from './revenue-units.writer.js';
import { resolveRefundExecution } from '../refundResolution.worker.js';

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

  // 2. Observed execution wins (monotonic fulfillment)
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
  } else {
    // 3. Ensure fulfillment state exists
    const existing = await db('order_fulfillment_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .first();

    if (!existing) {
      await db('order_fulfillment_status')
        .insert({
          lasyncro_fulfillment_id: crypto.randomUUID(),
          lasyncro_order_id: lasyncroOrderId,
          status: 'processing',
          status_updated_at: order.order_created_at,
        })
        .onConflict(['lasyncro_order_id'])
        .ignore();
    }
  }

  /**
   * ECONOMIC MATERIALIZATION BOUNDARY
   * ---------------------------------
   * Revenue units are materialized exactly once per reconciliation pass.
   *
   * Rules:
   * - Insert-only (no mutation)
   * - Deterministic identity (UUID v5)
   * - Idempotent via ON CONFLICT DO NOTHING
   *
   * This must remain single-invocation.
   */
  await writeOrderRevenueUnits(lasyncroOrderId);

  // 4. Apply refund executions
  const refundExecutions = await db('refund_executions')
    .where({ lasyncro_order_id: lasyncroOrderId });

  for (const execution of refundExecutions) {
    await resolveRefundExecution(execution.lasyncro_refund_execution_id);
  }

  return observed?.status === 'fulfilled' ? 'observed' : 'synthetic';
}