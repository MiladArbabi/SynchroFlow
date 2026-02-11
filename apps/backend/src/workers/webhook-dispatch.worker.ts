// apps/backend/src/workers/webhook-dispatch.worker.ts
//
// Webhook async re-entry worker
//
// This worker does NOT contain webhook logic.
// It replays jobs through the canonical router.
//

import { getQueueChannel } from '../queue';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { fromDispatchJob } from 'api-src/api/webhooks/fromDispatchJob';
import { WebhookDispatchJob } from 'api-src/api/webhooks/types.dispatchJob';

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

    // 🔁 Re-enter canonical path
    await WebhookRouter.dispatch(envelope);

    getQueueChannel(QUEUE_NAME).ack(msg as any);
  } catch (err) {
    // Fail-closed policy:
    // - Log
    // - ACK to avoid poison loops
    console.error('[webhook-worker] failed job:', err);
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