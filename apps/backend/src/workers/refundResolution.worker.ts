/**
 * NOTE:
 * Refund resolution is DERIVED STATE.
 * It may be recomputed, replayed, or rebuilt.
 *
 * refund_executions remains the ONLY financial truth.
 */


// apps/backend/src/workers/refundResolution.worker.ts

import db from 'api-src/db';

/**
 * Refund Resolution Worker
 * ------------------------
 * Applies refund execution effects onto order_revenue_units.
 *
 * INPUT:
 * - refund_executions
 * - refund_execution_line_items
 *
 * OUTPUT (DERIVED):
 * - order_revenue_units.returned_quantity
 * - has_return_block
 * - return_block_reason
 * - return_evaluated_at
 *
 * GUARANTEES:
 * - Replay-safe
 * - Idempotent per refund execution
 * - No execution mutation
 * - No SKU inference
 */
export async function resolveRefundExecution(
  refundExecutionId: number
): Promise<void> {
  await db.transaction(async trx => {
    const execution = await trx('refund_executions')
      .where({ id: refundExecutionId })
      .first();

    if (!execution || !execution.canonical_order_id) {
      return;
    }

    const lines = await trx('refund_execution_line_items')
      .where({ refund_execution_id: refundExecutionId });

    if (!lines.length) {
      return;
    }

    for (const line of lines) {
      const qty = Number(line.quantity_refunded);

      if (!Number.isFinite(qty) || qty <= 0) continue;

      await trx('order_revenue_units')
        .where({
          shop_id: execution.shop_id,
          canonical_order_id: execution.canonical_order_id,
          sku: line.sku,
        })
        .update({
          returned_quantity: trx.raw(
            'COALESCE(returned_quantity, 0) + ?',
            [qty]
          ),
          has_return_block: true,
          return_block_reason: 'customer_refunded',
          return_evaluated_at: trx.fn.now(),
        });
    }
  });
}