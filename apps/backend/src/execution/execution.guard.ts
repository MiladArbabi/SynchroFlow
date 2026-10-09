/**
 * EXECUTION GUARD (PHASE 1)
 * -------------------------
 * Central validation layer before execution.
 *
 * Current checks:
 * - decision_execution_queue state validation
 * - fail-closed retirement of the legacy proceed_fulfillment shortcut
 */

import db from '@lasyncro/backend-core/db.js';
import { ExecutionJob } from '../domain/decision/Decision.js';

export async function validateExecution(
  job: ExecutionJob,
  trx?: any
): Promise<void> {
  const q = trx ?? db;

  const row = await q('decision_execution_queue')
    .where({ decision_id: job.decision_id })
    .first();

  if (row) {
    if (row.status === 'success') {
      console.warn('[EXECUTION_GUARD_BLOCK_SUCCESS]', {
        decision_id: job.decision_id
      });
      throw new Error('EXECUTION_ALREADY_SUCCESS');
    }

    if (row.status === 'failure') {
      console.warn('[EXECUTION_GUARD_BLOCK_FAILED]', {
        decision_id: job.decision_id
      });
      throw new Error('EXECUTION_ALREADY_FAILED');
    }
  }

  if (job.action_type === 'proceed_fulfillment') {
    throw new Error('PROCEED_FULFILLMENT_RETIRED');
  }
}
