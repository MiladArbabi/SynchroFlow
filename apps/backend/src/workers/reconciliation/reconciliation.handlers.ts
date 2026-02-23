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
): Promise<{
  result: ReconciliationResult;
  affectedVariantIds: string[];
}> {

  // 1. Fetch sovereign order
  const order = await db('orders')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .first();

  if (!order) {
    throw new Error(`Order not found: ${lasyncroOrderId}`);
  }

  /**
   * ❗ EXECUTION AUTHORITY REMOVED
   * ------------------------------
   * Reconciliation must NEVER mutate execution state.
   *
   * Fulfillment truth is established exclusively via:
   *   staged_events → worker canonical ingestion.
   *
   * Reconciliation is strictly economic materialization.
   */

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

  const variantRows = await db('order_revenue_units')
    .where({ lasyncro_order_id: lasyncroOrderId })
    .distinct('lasyncro_variant_id');

  const affectedVariantIds = variantRows.map(r => r.lasyncro_variant_id);

  // 4. Apply refund executions
  const refundExecutions = await db('refund_executions')
    .where({ lasyncro_order_id: lasyncroOrderId });

  for (const execution of refundExecutions) {
    await resolveRefundExecution(execution.lasyncro_refund_execution_id);
  }

  return {
    result: observed?.status === 'fulfilled' ? 'observed' : 'synthetic',
    affectedVariantIds,
  };
}