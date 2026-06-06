// apps/backend/src/workers/webhook-dispatch.worker.ts
//
// Webhook async re-entry worker
//
// This worker does NOT contain webhook logic.
// It replays jobs through the canonical router.
//

import { getQueueChannel } from '../queue.js';
import { WebhookRouter } from '../api/webhooks/webhookRouter.js';
import { fromDispatchJob } from '../api/webhooks/fromDispatchJob.js';
import { WebhookDispatchJob } from '../api/webhooks/types.dispatchJob.js';

const QUEUE_NAME = 'webhook.dispatch.v1';

export async function processWebhookDispatchMessage(
  msg: { content: Buffer } | null
) {
  if (!msg) return;

  try {
    const job = JSON.parse(
      msg.content.toString()
    ) as WebhookDispatchJob;

    const envelope = fromDispatchJob(job);
    (envelope as any).__fromQueue = true;

    // 🔁 Re-enter canonical path
    await WebhookRouter.dispatch(envelope);

    getQueueChannel(QUEUE_NAME).ack(msg as any);
 } catch (err: any) {
    /**
     * ACKNOWLEDGED ON FAILURE (INTENTIONAL — NO DLQ CONFIGURED)
     * ----------------------------------------------------------
     * ACK is deliberate: without a dead-letter queue, NACK requeue=true
     * causes infinite poison loops; NACK requeue=false silently drops.
     *
     * TODO: Add DLX topology in queue.ts (x-dead-letter-exchange) so
     * failed jobs route to webhook.dispatch.dlq for replay/inspection.
     *
     * Until then: emit fatal signal for log-based alerting.
     */
    console.error('[WEBHOOK_DISPATCH_JOB_DROPPED]', {
      error: err?.message,
      queue: QUEUE_NAME,
      action: 'acked_no_dlq',
    });
    getQueueChannel(QUEUE_NAME).ack(msg as any);
  }
}

export function startWebhookWorker() {
  const channel = getQueueChannel(QUEUE_NAME);

  channel.consume(
    QUEUE_NAME,
    processWebhookDispatchMessage,
    { noAck: false }
  );

  console.log('[webhook-worker] listening on', QUEUE_NAME);
}