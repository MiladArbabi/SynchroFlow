import { getQueueChannel } from '../queue.js';
import { ExecutionJob } from '../domain/decision/Decision.js';

export const EXECUTION_QUEUE = 'execution.jobs.v1';

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

  const ok = channel.sendToQueue(EXECUTION_QUEUE, payload, {
    persistent: true
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