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

    // 1️⃣ Lock sovereign order to prevent concurrent reconciliation
    const order = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .forUpdate()
      .first();

    if (!order) {
      throw new Error(`Order not found: ${lasyncroOrderId}`);
    }

    /**
     * ATOMIC RECONCILIATION BOUNDARY
     * ------------------------------
     * All economic, projection, and obligation mutations
     * MUST occur inside this single transaction.
     *
     * Guarantees:
     * - No partial economic state
     * - No projection drift
     * - No obligation drift
     */

    // 2️⃣ Economic materialization
    await writeOrderRevenueUnits(lasyncroOrderId, trx);

    // 3️⃣ Apply refund executions
    const refundExecutions = await trx('refund_executions')
      .where({ lasyncro_order_id: lasyncroOrderId });

    for (const execution of refundExecutions) {
      await resolveRefundExecution(
        execution.lasyncro_refund_execution_id,
        trx
      );
    }

    // 4️⃣ Derive affected variants AFTER economic mutation
    const variantRows = await trx('order_revenue_units')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .distinct('lasyncro_variant_id');

    const affectedVariantIds = variantRows.map(r => r.lasyncro_variant_id);

    // 5️⃣ Projection rebuild (transaction-participating)
    if (affectedVariantIds.length > 0) {
      await rebuildInventoryProjectionForVariants(
        order.shop_id,
        affectedVariantIds,
        trx
      );
    }

    // 6️⃣ Obligation recomputation (transaction-participating)
    await computeObligationFlagsForOrders(
      [lasyncroOrderId],
      trx
    );

    return {
      result: observed?.status === 'fulfilled' ? 'observed' : 'synthetic',
      affectedVariantIds,
    };
  });
}