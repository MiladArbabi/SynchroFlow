import { getQueueChannel } from '../queue.js';
import { ExecutionJob } from '../domain/decision/Decision.js';

export const EXECUTION_QUEUE = 'execution.jobs.v1';

/**
 * QUEUE TOPOLOGY (CRITICAL)
 * -------------------------
 * Defines durability + retry behavior.
 *
 * Guarantees:
 * - No execution loss
 * - At-least-once delivery
 * - Controlled retry via DLQ
 *
 * Without this:
 * - execution jobs can be dropped silently
 */
export async function assertExecutionQueue(channel: any) {
  const DLX = 'execution.dlx';
  const DLQ = `${EXECUTION_QUEUE}.dlq`;

  // Dead-letter exchange
  await channel.assertExchange(DLX, 'direct', { durable: true });

  // Main execution queue
  await channel.assertQueue(EXECUTION_QUEUE, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': DLX,
      'x-dead-letter-routing-key': DLQ
    }
  });

  // Dead-letter queue (retry buffer)
  await channel.assertQueue(DLQ, {
    durable: true,
    arguments: {
      'x-message-ttl': 5000, // 5s retry delay (tunable)
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': EXECUTION_QUEUE
    }
  });

  // Bind DLQ
  await channel.bindQueue(DLQ, DLX, DLQ);

  console.info('[EXECUTION_QUEUE_ASSERTED]', {
    queue: EXECUTION_QUEUE,
    dlq: DLQ
  });
}

/**
 * EXECUTION DISPATCH (QUEUE-BASED)
 *
 * Guarantees:
 * - Durable job delivery
 * - Decoupled execution
 *
 * CRITICAL:
 * - Must serialize to JSON buffer
 * - Must not silently fail
 */
export async function enqueueExecutionJob(job: ExecutionJob): Promise<void> {
  const channel = getQueueChannel(EXECUTION_QUEUE);

  const payload = Buffer.from(JSON.stringify(job));

  /**
   * ENQUEUE IDEMPOTENCY (REVISED — SOURCE OF TRUTH FIX)
   * ---------------------------------------------------
   * decision_execution_queue is ALREADY the source of truth.
   *
   * Correct model:
   * - DB insert happens BEFORE enqueue (ingestion layer)
   * - Queue MUST NOT block on existence
   *
   * Duplicate protection responsibility:
   * - DB uniqueness (decision_id)
   * - Worker idempotency guard
   *
   * This check previously caused:
   * → ALL jobs to be skipped (system deadlock)
   */
  const existing = await import('@lasyncro/backend-core/db.js')
    .then(m => m.default('decision_execution_queue')
      .where({ decision_id: job.decision_id })
      .first()
    );

  if (!existing) {
    console.error('[EXECUTION_ENQUEUE_BLOCKED_NO_DB_ROW]', {
      decision_id: job.decision_id
    });

    throw new Error('[EXECUTION_QUEUE_DESYNC]');
  }

  /**
   * RETRY METADATA (CRITICAL)
   * -------------------------
   * - Initializes retry tracking at enqueue time
   * - Enables DLQ + worker visibility into retry lifecycle
   *
   * Headers:
   * - x-retry-count: number of attempts (starts at 0)
   *
   * Future:
   * - can extend with retry reason / trace id
   */
  const ok = channel.sendToQueue(EXECUTION_QUEUE, payload, {
    persistent: true,
    headers: {
      'x-retry-count': 0
    }
  });

  if (!ok) {
    console.error('[EXECUTION_ENQUEUE_FAILED]', {
      decision_id: job.decision_id
    });

    throw new Error('[EXECUTION_QUEUE_BACKPRESSURE]');
  }

  console.info('[EXECUTION_ENQUEUED]', {
    decision_id: job.decision_id,
    action_type: job.action_type
  });
}