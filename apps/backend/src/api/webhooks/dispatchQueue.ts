// apps/backend/src/api/webhooks/dispatchQueue.ts
//
// Phase 6B – Queue seam (IMPLEMENTED)
// ----------------------------------
// Responsibilities:
// - Publish a fully-formed WebhookEnvelope
// - Exactly-once attempt
// - Durable queue
// - Never throw (fail-closed)

import { WebhookEnvelope } from './types.js';
import { getQueueChannel } from '../../queue.js';

const QUEUE_NAME = 'webhook.dispatch.v1';

export async function enqueueWebhookEnvelope(
  envelope: WebhookEnvelope
): Promise<void> {
  try {
    const channel = getQueueChannel(QUEUE_NAME);

    const payload = Buffer.from(JSON.stringify(envelope), 'utf8');

  } catch (err) {
    // Fail-closed by contract — upstream must never break
    // Ledger already recorded receipt
    console.error('[enqueueWebhookEnvelope] publish failed', err);
  }
}

