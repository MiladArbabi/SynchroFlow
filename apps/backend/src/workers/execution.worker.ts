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

  /**
 * TRANSACTION TYPING (STRICT)
 * ---------------------------
 * Enforces correct DB transaction contract.
 * Prevents unsafe operations inside execution lifecycle.
 */
await db.transaction(async (trx: Parameters<typeof decisionRepo.markStarted>[0]) => {
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
  msg: { content: Buffer; properties?: any } | null
) {
  if (!msg) return;

  try {
    const job = JSON.parse(
      msg.content.toString()
    ) as ExecutionJob;

    /**
     * RETRY METADATA EXTRACTION (CRITICAL)
     * -----------------------------------
     * Extract retry count from RabbitMQ headers.
     *
     * Guarantees:
     * - visibility into retry attempts
     * - enables future retry cap + poison handling
     */
    const retryCount = Number(
        msg.properties?.headers?.['x-retry-count'] || 0
    );

    console.info('[EXECUTION_RETRY_METADATA]', {
        decision_id: job.decision_id,
        retry_count: retryCount
    });

    /**
     * RETRY CAP ENFORCEMENT (CRITICAL)
     * --------------------------------
     * Prevents infinite retry loops.
     *
     * Policy:
     * - Max attempts = 3
     * - Beyond this → terminal failure (poison)
     */
    const MAX_RETRY_ATTEMPTS = 3;

    if (retryCount >= MAX_RETRY_ATTEMPTS) {
        console.error('[EXECUTION_POISON_MESSAGE]', {
            decision_id: job.decision_id,
            retry_count: retryCount
        });

        /**
         * ACK to REMOVE from queue permanently.
         * Prevents infinite DLQ cycling.
         */
        getQueueChannel(EXECUTION_QUEUE).ack(msg as any);
            return;
    }

    await executeJob(job);

    getQueueChannel(EXECUTION_QUEUE).ack(msg as any);
  } catch (err) {
    console.error('[EXECUTION_WORKER_JOB_FAILED]', {
        error: (err as Error).message
    });

    /**
     * RETRY + POISON ROUTING (CRITICAL)
     * ---------------------------------
     * - Increment retry count via headers
     * - Requeue manually with updated metadata
     * - Preserve DLQ fallback for safety
     */
    const retryCount = Number(
    msg.properties?.headers?.['x-retry-count'] || 0
    );

    const nextRetryCount = retryCount + 1;

    const channel = getQueueChannel(EXECUTION_QUEUE);

    /**
     * RETRY BACKOFF STRATEGY (ALIGNED WITH RECONCILIATION)
     * ---------------------------------------------------
     * - Exponential backoff
     * - Cap at 30s
     * - Matches reconciliation retry behavior for consistency
     */
    const retryDelayMs = Math.min(
        1000 * Math.pow(2, retryCount),
        30000
    );

    channel.sendToQueue(
        EXECUTION_QUEUE,
        msg.content,
        {
            persistent: true,
            headers: {
            ...msg.properties?.headers,
            'x-retry-count': nextRetryCount
            },
            expiration: String(retryDelayMs) // delay before retry
        }
    );

        console.warn('[EXECUTION_RETRY_SCHEDULED]', {
        retry_count: nextRetryCount,
        delay_ms: retryDelayMs
    });

    // ACK original message to prevent duplicate DLQ routing
    channel.ack(msg as any);

    console.warn('[EXECUTION_RETRY_REQUEUED]', {
        retry_count: nextRetryCount
    });
  }
}

export function startExecutionWorker() {
  const channel = getQueueChannel(EXECUTION_QUEUE);

  channel.addSetup(async (ch: any) => {
    const { assertExecutionQueue } = await import('../queues/execution.queue.js');

    await assertExecutionQueue(ch);

    /**
     * CRITICAL:
     * Ensures queue exists BEFORE consume.
     * Prevents:
     * - missing queue crashes
     * - undefined retry behavior
     */
  });

  channel.consume(
    EXECUTION_QUEUE,
    processExecutionMessage,
    { noAck: false }
  );

  console.log('[execution-worker] listening on', EXECUTION_QUEUE);
}