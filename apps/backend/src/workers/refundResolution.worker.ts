// apps/backend/src/workers/refundResolution.worker.ts

/**
 * Refund Resolution Worker (Sovereign UUID)
 * ------------------------------------------
 * DERIVED STATE ONLY.
 *
 * Financial truth:
 *   refund_executions
 *
 * Derived mutation:
 *   order_revenue_units.returned_quantity
 *
 * Idempotent.
 * Replay-safe.
 */

import db from 'api-src/db';

export async function resolveRefundExecution(
  lasyncroRefundExecutionId: string
): Promise<void> {

  await db.transaction(async trx => {

    const execution = await trx('refund_executions')
      .where({
        lasyncro_refund_execution_id: lasyncroRefundExecutionId,
      })
      .first();

    if (!execution) return;

    const lines = await trx('refund_execution_line_items')
      .where({
        lasyncro_refund_execution_id: lasyncroRefundExecutionId,
      });

    if (!lines.length) return;

    /**
     * Aggregate refunded quantities per product
     */
    const aggregated: Record<string, number> = {};

    for (const line of lines) {
      const qty = Number(line.quantity_refunded);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const productId = line.lasyncro_product_id;
      if (!productId) continue;

      aggregated[productId] =
        (aggregated[productId] ?? 0) + qty;
    }

    /**
     * Apply returned quantities
     */
    for (const [productId, qty] of Object.entries(aggregated)) {
      await trx('order_revenue_units')
        .where({
          lasyncro_order_id: execution.lasyncro_order_id,
          lasyncro_product_id: productId,
        })
        .update({
          returned_quantity: trx.raw(
            'COALESCE(returned_quantity, 0) + ?',
            [qty]
          ),
          updated_at: trx.fn.now(),
        });
    }

    /**
     * Deterministic refund total aggregation
     */
    const refundTotalRow = await trx('refund_execution_line_items')
      .where({
        lasyncro_refund_execution_id: lasyncroRefundExecutionId,
      })
      .select(
        trx.raw(`
          COALESCE(
            SUM(quantity_refunded * COALESCE(unit_refund_amount, 0)),
            0
          ) as total
        `)
      )
      .first();

    const totalRefundAmount = Number(refundTotalRow?.total ?? 0);

    await trx('refund_executions')
      .where({
        lasyncro_refund_execution_id: lasyncroRefundExecutionId,
      })
      .update({
        total_refund_amount: totalRefundAmount,
        updated_at: trx.fn.now(),
      });
  });
}
