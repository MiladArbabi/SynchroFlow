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

import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from './types.js';
import { WebhookDispatchJob } from './types.dispatchJob.js';

const QUEUE_NAME = 'webhook.dispatch.v1';

export async function enqueueWebhookEnvelope(
  envelope: WebhookEnvelope
): Promise<void> {
  try {

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

    console.log('[WEBHOOK ENQUEUED]', {
      integration: job.integration,
      eventType: job.eventType,
      shopDomain: job.shopDomain,
      eventId: job.eventId,
    });

    /**
     * INVARIANT: shopId is mandatory for domain event emission.
     * ----------------------------------------------------------
     * Webhook without shop context is a structural violation.
     * Fail fast to avoid corrupt domain state.
     */
    if (typeof envelope.shopId !== 'number') {
      console.error('[WEBHOOK_INVARIANT_VIOLATION] missing shopId', {
        integration: job.integration,
        eventId: job.eventId,
        eventType: job.eventType,
      });
      throw new Error('WEBHOOK_SHOP_ID_REQUIRED');
    }

    /**
     * DOMAIN EVENT EMISSION — WEBHOOK RECEIVED
     * ----------------------------------------
     * Webhooks must enter the system as immutable domain events.
     * No direct broker publishing allowed.
     */
    await db.transaction(async trx => {
      const externalEventId = `webhook:${job.integration}:${job.eventId}`;

      const [event] = await trx('domain_events')
        .insert({
          shop_id: envelope.shopId,
          event_type: `webhook/${job.eventType}`,
          event_payload: job,
          event_time: trx.fn.now(),
          event_version: 1,
          external_event_id: externalEventId,
        })
        .returning(['id']);

        console.info('[OUTBOX_TRIGGER_EXPECTED]', {
          domainEventId: event.id,
        });

      /**
       * OUTBOX HANDLED BY DB TRIGGER
       * ----------------------------
       * domain_event_auto_outbox AFTER INSERT trigger
       * guarantees exactly one outbox row.
       *
       * DO NOT insert into domain_event_outbox manually.
       * Doing so causes duplicate key violations.
       */
    });

    console.info('[WEBHOOK_DOMAIN_EVENT_EMITTED]', {
      integration: job.integration,
      eventType: job.eventType,
      eventId: job.eventId,
    });

  } catch (err) {
    console.error('[enqueueWebhookEnvelope] publish failed', err);
  }
}