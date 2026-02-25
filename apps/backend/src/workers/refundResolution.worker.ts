// apps/backend/src/workers/refundResolution.worker.ts

/**
 * Refund Resolution Worker (Sovereign UUID)
 * ------------------------------------------
 * DERIVED STATE ONLY.
 *
 * Financial truth:
 *   refund_executions
 *
 * Revenue units are immutable.
 * Refund quantities are derived at read-time
 * from refund_execution_line_items.
 *
 * This worker maintains:
 *   - refund_executions.total_refund_amount
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

  /**
   * REFUND DERIVATION MODEL
   * -----------------------
   * Revenue units are immutable.
   * Refund quantities are derived at read-time
   * from refund_execution_line_items.
   *
   * No per-line mutation or aggregation occurs here.
   * This worker only maintains refund_executions.total_refund_amount.
   */

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