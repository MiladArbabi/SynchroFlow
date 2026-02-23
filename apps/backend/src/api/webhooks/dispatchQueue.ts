// apps/backend/src/api/webhooks/dispatchQueue.ts
//
// Phase 6B – Queue seam (HARDENED)
// --------------------------------
// Responsibilities:
// - Publish a VERSIONED WebhookDispatchJob (NOT raw envelope)
// - Preserve routing metadata (shopDomain)
// - Attach deterministic enqueue timestamp
// - Durable queue
// - Fail-closed (never throw)
//
// Invariant:
// Worker expects WebhookDispatchJobV1.
// Envelope MUST NOT be serialized directly.
//

import { WebhookEnvelope } from './types.js';
import { WebhookDispatchJob } from './types.dispatchJob.js';
import { getQueueChannel } from '../../queue.js';

const QUEUE_NAME = 'webhook.dispatch.v1';

export async function enqueueWebhookEnvelope(
  envelope: WebhookEnvelope
): Promise<void> {
  try {
    const channel = getQueueChannel(QUEUE_NAME);

    /**
     * Construct canonical dispatch job.
     * This is the ONLY shape allowed over transport.
     */
    const job: WebhookDispatchJob = {
      version: 1,
      integration: envelope.integration,
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      rawPayload: envelope.rawPayload,
      shopDomain: envelope.shopDomain,
      enqueuedAt: new Date().toISOString(),
      __fromQueue: true,
    };

    const payload = Buffer.from(JSON.stringify(job), 'utf8');

    await channel.addSetup(async (ch: any) => {
      await ch.assertQueue(QUEUE_NAME, { durable: true });
    });

    channel.sendToQueue(QUEUE_NAME, payload, {
      persistent: true,
    });

    console.log('[WEBHOOK ENQUEUED]', {
      integration: job.integration,
      eventType: job.eventType,
      shopDomain: job.shopDomain,
      eventId: job.eventId,
    });

  } catch (err) {
    console.error('[enqueueWebhookEnvelope] publish failed', err);
  }
}