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

import { Knex } from 'knex';

export async function resolveRefundExecution(
  lasyncroRefundExecutionId: string,
  trx: Knex.Transaction
): Promise<void> {

  /**
   * TRANSACTION CONTRACT
   * --------------------
   * Refund resolution MUST participate in reconciliation transaction.
   * It MUST NOT open its own transaction.
   */

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

  for (const line of lines) {
    const totalRow = await trx('refund_execution_line_items')
      .where({
        lasyncro_revenue_unit_id: line.lasyncro_revenue_unit_id,
      })
      .select(
        trx.raw(`
          COALESCE(SUM(refunded_quantity), 0) as total
        `)
      )
      .first();

    const totalReturned = Number(totalRow?.total ?? 0);

    await trx('order_revenue_units')
      .where({
        lasyncro_revenue_unit_id: line.lasyncro_revenue_unit_id,
      })
      .update({
        returned_quantity: totalReturned,
        updated_at: trx.fn.now(),
      });
  }

  const refundTotalRow = await trx('refund_execution_line_items')
    .where({
      lasyncro_refund_execution_id: lasyncroRefundExecutionId,
    })
    .select(
      trx.raw(`
        COALESCE(
          SUM(refunded_amount),
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
}