/**
 * EXECUTION WORKER (PHASE 1 — INLINE / DIRECT INVOCATION)
 *
 * WHY:
 * - Provides first concrete execution layer
 * - Consumes ExecutionJob and invokes handler
 *
 * GUARANTEES:
 * - Idempotency delegated to handler (via decision_id)
 * - Hard failure if handler missing
 *
 * NOTE:
 * - Queue integration will replace direct invocation
 */

import db from '@lasyncro/backend-core/db.js';
import { ExecutionJob } from '../domain/decision/Decision.js';
import { getExecutionHandler } from '../execution/execution.registry.js';
import { DecisionRepository } from '../domain/decision/decision.repository.js';
import { getQueueChannel } from '../queue.js';
import { EXECUTION_QUEUE } from '../queues/execution.queue.js';

const decisionRepo = new DecisionRepository();

export async function executeJob(job: ExecutionJob): Promise<void> {
  console.info('[EXECUTION_WORKER_START]', {
    decision_id: job.decision_id,
    action_type: job.action_type
  });

  const handler = getExecutionHandler(job.action_type);

  await db.transaction(async (trx: any) => {
    await decisionRepo.markStarted(trx, job.decision_id);

    try {
      await handler(job);

      await decisionRepo.markSuccess(trx, job.decision_id);

      console.info('[EXECUTION_WORKER_SUCCESS]', {
        decision_id: job.decision_id
      });
    } catch (error) {
      await decisionRepo.markFailure(
        trx,
        job.decision_id,
        (error as Error).message
      );

      console.error('[EXECUTION_WORKER_FAILURE]', {
        decision_id: job.decision_id,
        error: (error as Error).message
      });

      throw error;
    }
  });
}

/**
 * QUEUE MESSAGE HANDLER
 * ---------------------
 * Parses job and executes it.
 *
 * FAIL POLICY:
 * - Log error
 * - ACK to prevent poison loops (phase 1)
 * - Retry strategy will be added later (DLQ)
 */
async function processExecutionMessage(
  msg: { content: Buffer } | null
) {
  if (!msg) return;

  try {
    const job = JSON.parse(
      msg.content.toString()
    ) as ExecutionJob;

    await executeJob(job);

    getQueueChannel(EXECUTION_QUEUE).ack(msg as any);
  } catch (err) {
    console.error('[EXECUTION_WORKER_JOB_FAILED]', err);

    // Phase 1: fail-closed (no requeue to avoid infinite loops)
    getQueueChannel(EXECUTION_QUEUE).ack(msg as any);
  }
}

export function startExecutionWorker() {
  const channel = getQueueChannel(EXECUTION_QUEUE);

  channel.consume(
    EXECUTION_QUEUE,
    processExecutionMessage,
    { noAck: false }
  );

  console.log('[execution-worker] listening on', EXECUTION_QUEUE);
}