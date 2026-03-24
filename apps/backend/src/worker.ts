// apps/backend/src/worker.ts

import { getQueueChannel } from './queue.js';
import { projectDomainEventFromMessage } from './projection/projection.engine.js';

/**
 * WORKER TRANSPORT ADAPTER
 * -------------------------
 * Handles RabbitMQ delivery semantics only.
 */

let eventChannel: ReturnType<typeof getQueueChannel> | null = null;

function getEventChannel() {
  if (!eventChannel) {
    eventChannel = getQueueChannel('events');
  }
  return eventChannel as NonNullable<typeof eventChannel>;
}

async function processMessage(msg: { content: Buffer } | null) {
  try {
    /**
     * PROJECTION DISABLED IN QUEUE WORKER (MIGRATION STEP)
     * ---------------------------------------------------
     * DB-driven worker is now the single source of truth.
     *
     * Queue still receives events for observability,
     * but MUST NOT mutate projection state.
     */
    console.warn('[QUEUE_PROJECTION_DISABLED]', {
      raw: msg?.content?.toString(),
    });

    if (msg && 'fields' in (msg as any)) {
      getEventChannel().ack(msg as any);
    }
  } catch (error) {
    if (msg && 'fields' in (msg as any)) {
      try {
        
        const errMsg = String((error as any)?.message ?? error);

          if (errMsg.includes('[PROJECTION_STATE_CORRUPTED]')) {
            console.error('[WORKER_DLQ_PROJECTION_CORRUPTION]', {
              error: errMsg,
            });

            /**
             * CRITICAL FIX — DEAD LETTER CORRUPTED EVENTS
             * --------------------------------------------
             * Prevent infinite crash loop.
             *
             * Behavior:
             * - Send message to DLQ
             * - Allow system to continue processing other events
             *
             * Operator must:
             * - reset projection
             * - replay from scratch
             */
            getEventChannel().nack(msg as any, false, false); // send to DLQ
            return;
          }

          getEventChannel().nack(msg as any, false, false);

      } catch (nackError) {
        console.error(
          '[worker] Failed to nack message after processing error:',
          nackError
        );
      }
    }

    throw error;
  }
}

export function startWorker() {
  console.log('[worker] Starting unified canonical worker...');
  /**
   * DB PROJECTION WORKER (AUTHORITATIVE ORDERING)
   * ---------------------------------------------
   * Runs in parallel with queue worker during migration phase.
   */
  import('./workers/projection.db.worker.js')
    .then(({ startDbProjectionWorker }) => {
      startDbProjectionWorker();
    })
    .catch((err) => {
      console.error('[worker] Failed to start DB projection worker', err);
    });

  const channel = getEventChannel();

  channel.addSetup(async (ch: any) => {

    await ch.assertExchange('events.dlx', 'direct', { durable: true });

    await ch.assertQueue('events', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'events.dlx',
        'x-dead-letter-routing-key': 'dead',
        /**
         * CRITICAL FIX — SINGLE ACTIVE CONSUMER
         * -------------------------------------
         * Ensures only ONE worker processes messages.
         *
         * Without this:
         * - multiple consumers → out-of-order execution
         * - breaks projection determinism (observed issue)
         */
        'x-single-active-consumer': true
      }
    });

    await ch.assertQueue('events.dead', { durable: true });
    await ch.bindQueue('events.dead', 'events.dlx', 'dead');

    await ch.prefetch(1);

    /**
     * CRITICAL SAFETY GUARD — QUEUE STATE VISIBILITY
     * ----------------------------------------------
     * Detects if queue contains residual events during startup.
     *
     * If queue is non-empty on cold start:
     * → system may replay out-of-order
     * → must be explicitly acknowledged by operator
     */
    const q = await ch.checkQueue('events');

    if (q.messageCount > 0) {
      console.error('[WORKER_QUEUE_NOT_EMPTY_ON_START]', {
        queue: 'events',
        messageCount: q.messageCount,
        action: 'Purge queue before rebuild to ensure deterministic replay',
      });
    }

   console.warn('[QUEUE_CONSUMER_DISABLED]');

  });

  console.log('[worker] Worker ready. Awaiting domain events...');
}