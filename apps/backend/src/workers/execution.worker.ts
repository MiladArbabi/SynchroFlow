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
import { validateExecution } from '../execution/execution.guard.js';

export async function executeJob(
  job: ExecutionJob,
  trx?: any
): Promise<void> {

  console.info('[EXECUTION_WORKER_START]', {
    decision_id: job.decision_id,
    action_type: job.action_type
  });

  const handler = getExecutionHandler(job.action_type);

  /**
   * TRANSACTION HANDLING (CRITICAL)
   * -------------------------------
   * - If trx provided → reuse it (manual execution path)
   * - Else → create new transaction (worker path)
   */
  if (trx) {
    await DecisionRepository.markStarted(trx, job.decision_id);

    try {
      await validateExecution(job, trx);
      await handler(job, trx);

      /**
       * NOTE:
       * - Pass trx to handler for atomic execution
       * - Ensures handler DB writes are part of same transaction
       */
      await DecisionRepository.markSuccess(trx, job.decision_id);

      /**
       * EXECUTION COMPLETION TIMESTAMP (CRITICAL)
       * -----------------------------------------
       * executed_at must reflect actual execution completion.
       */
      await trx('decision_execution_queue')
        .where({ decision_id: job.decision_id })
        .update({
          status: 'success',
          executed_at: trx.fn.now(),
        });

      console.info('[EXECUTION_WORKER_SUCCESS]', {
        decision_id: job.decision_id
      });
    } catch (error) {
      await DecisionRepository.markFailure(
        trx,
        job.decision_id,
        (error as Error).message
      );

      /**
       * FAILURE TIMESTAMP (CRITICAL)
       * ----------------------------
       * Ensures lifecycle closes even on failure.
       */
      await trx('decision_execution_queue')
        .where({ decision_id: job.decision_id })
        .update({
          status: 'failure',
          executed_at: trx.fn.now(),
          error: (error as Error).message,
        });

      console.error('[EXECUTION_WORKER_FAILURE]', {
        decision_id: job.decision_id,
        error: (error as Error).message
      });

      throw error;
    }
  } else {
    await db.transaction(async (trx) => {
      await DecisionRepository.markStarted(trx, job.decision_id);

      try {
        await validateExecution(job, trx);
        await handler(job, trx);

        /**
         * NOTE:
         * - Same guarantee for worker-managed transactions
         * - Prevents partial commits across boundaries
         */
        await DecisionRepository.markSuccess(trx, job.decision_id);

        /**
         * EXECUTION COMPLETION TIMESTAMP (CRITICAL)
         * -----------------------------------------
         * executed_at must reflect actual execution completion.
         */
        await trx('decision_execution_queue')
          .where({ decision_id: job.decision_id })
          .update({
            status: 'success',
            executed_at: trx.fn.now(),
          });

        console.info('[EXECUTION_WORKER_SUCCESS]', {
          decision_id: job.decision_id
        });
      } catch (error) {
        // AFTER
        await DecisionRepository.markFailure(
          trx,
          job.decision_id,
          (error as Error).message
        );

        /**
         * FAILURE TIMESTAMP (CRITICAL)
         * ----------------------------
         * Ensures lifecycle closes even on failure.
         */
        await trx('decision_execution_queue')
          .where({ decision_id: job.decision_id })
          .update({
            status: 'failure',
            executed_at: trx.fn.now(),
            error: (error as Error).message,
          });

        console.error('[EXECUTION_WORKER_FAILURE]', {
          decision_id: job.decision_id,
          error: (error as Error).message
        });

        throw error;
      }
    });
  }
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
     * EXECUTION IDEMPOTENCY GUARD (CRITICAL)
     * -------------------------------------
     * Prevents duplicate execution across retries / race conditions.
     *
     * Policy:
     * - If already executed → skip
     * - If already started → skip (in-flight protection)
     */
    const existing = await db('decision_execution_queue')
      .where({ decision_id: job.decision_id })
      .first();

    if (existing) {
      /**
       * EXECUTION IDEMPOTENCY GUARD (CORRECTED)
       * ---------------------------------------
       * - success → already executed → skip
       * - in_progress → already being executed → skip
       *
       * IMPORTANT:
       * - pending MUST be executed (it is the entry state)
       */
      if (existing.status === 'success' || existing.status === 'in_progress') {
        console.warn('[EXECUTION_SKIPPED_ALREADY_PROCESSED]', {
          decision_id: job.decision_id,
          status: existing.status
        });

        getQueueChannel(EXECUTION_QUEUE).ack(msg as any);
        return;
      }
    }

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

    /* console.info('[EXECUTION_RETRY_METADATA]', {
        decision_id: job.decision_id,
        retry_count: retryCount
    }); */

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
         * TERMINAL FAILURE (CRITICAL)
         * ---------------------------
         * Retry cap reached → must mark decision as failure.
         * Prevents stuck "pending/in_progress" decisions.
         */
        await db.transaction(async (trx) => {
          await DecisionRepository.markFailure(
            trx,
            job.decision_id,
            'Max retry attempts exceeded'
          );

          await trx('decision_execution_queue')
            .where({ decision_id: job.decision_id })
            .update({
              status: 'failure',
              executed_at: trx.fn.now(),
              error: 'Max retry attempts exceeded',
            });
        });

        /**
         * ACK to REMOVE from queue permanently.
         * Prevents infinite DLQ cycling.
         */
        getQueueChannel(EXECUTION_QUEUE).ack(msg as any);
        return;
    }

    /**
     * EXECUTION MODE GATE (CRITICAL)
     * ------------------------------
     * Prevents automatic execution of manual decisions.
     *
     * Manual mode:
     * - job stays in system
     * - requires explicit trigger (API/UI)
     */
    if (job.execution_mode === 'manual') {
      console.info('[EXECUTION_SKIPPED_MANUAL_MODE]', {
        decision_id: job.decision_id
      });

      /**
       * IDEMPOTENT INSERT (SAFE + OBSERVABLE)
       * -------------------------------------
       * - Uses UNIQUE(decision_id)
       * - Detects duplicates via error handling (no schema change required)
       */
      try {
        await db('decision_execution_queue').insert({
          decision_id: job.decision_id,
          shop_id: job.shop_id,
          status: 'pending',
          created_at: db.fn.now()
        });
      } catch (err: any) {
        /**
         * DUPLICATE DETECTION (CRITICAL)
         * ------------------------------
         * Postgres unique violation = 23505
         */
        if (err.code === '23505') {
          console.warn('[EXECUTION_DUPLICATE_DETECTED]', {
            decision_id: job.decision_id
          });
        } else {
          throw err;
        }
      }

      getQueueChannel(EXECUTION_QUEUE).ack(msg as any);

      return;
    }

    /**
     * AUTOMATED EXECUTION PATH
     * ------------------------
     * Reached only when execution_mode !== 'manual'.
     * Delegates to executeJob which owns the full transaction,
     * lifecycle tracking, and handler dispatch.
     *
     * ACK only after successful execution to preserve at-least-once guarantee.
     */
    console.info('[EXECUTION_WORKER_AUTOMATED]', {
      decision_id: job.decision_id,
      action_type: job.action_type
    });

    await executeJob(job);

    getQueueChannel(EXECUTION_QUEUE).ack(msg as any);

  } catch (err) {
    console.error('[EXECUTION_WORKER_JOB_FAILED]', {
      decision_id: (() => {
        try {
          return JSON.parse(msg.content.toString())?.decision_id;
        } catch {
          return 'UNKNOWN_DECISION_ID';
        }
      })(),
      error_message: (err as Error).message,
      /**
       * NOTE:
       * - Fixes duplicate key bug (previously overwrote error)
       * - Adds decision_id for observability + traceability
       * - Safe parsing prevents secondary failure during logging
       */
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

  /**
   * SAFE RETRY ENQUEUE (CRITICAL)
   * -----------------------------
   * - Must confirm enqueue BEFORE ack
   * - Prevents message loss on failure
   */
  const enqueueOk = channel.sendToQueue(
    EXECUTION_QUEUE,
    msg.content,
    {
      persistent: true,
      headers: {
        ...msg.properties?.headers,
        'x-retry-count': nextRetryCount
      },
      expiration: String(retryDelayMs)
    }
  );

  if (!enqueueOk) {
    /**
     * DO NOT ACK → message will be redelivered
     */
    console.error('[EXECUTION_RETRY_ENQUEUE_FAILED]', {
      decision_id: (() => {
        try {
          return JSON.parse(msg.content.toString())?.decision_id;
        } catch {
          return 'UNKNOWN_DECISION_ID';
        }
      })(),
      retry_count: nextRetryCount
    });

    return;
  }

  console.warn('[EXECUTION_RETRY_SCHEDULED]', {
    retry_count: nextRetryCount,
    delay_ms: retryDelayMs
  });

  /**
   * ACK ONLY AFTER SUCCESSFUL ENQUEUE
   */
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