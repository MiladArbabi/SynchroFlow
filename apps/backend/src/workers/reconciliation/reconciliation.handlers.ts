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
    await trx('order_revenue_units')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        returned_quantity: 0,
      });

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
    }

    await computeObligationFlagsForOrders(
      [lasyncroOrderId],
      trx
    );

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