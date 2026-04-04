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
import { buildExternalEventId } from './buildExternalEventId.js';

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

      const externalEventId = buildExternalEventId({
        source: 'webhook',
        integration: job.integration,
        eventId: job.eventId,
      });

      /**
       * CANONICAL EVENT TIME DERIVATION
       * --------------------------------
       * Domain events must never use wall-clock timestamps.
       *
       * Priority order:
       * 1. Shopify payload timestamps (created_at / updated_at)
       * 2. Adapter-derived envelope timestamp
       *
       * If none exist → structural ingestion violation.
       */
      const payload: any = job.rawPayload;

      const canonicalEventTime =
        payload?.created_at ??
        payload?.updated_at ??
        envelope?.receivedAt ??
        null;

      if (!canonicalEventTime) {
        console.error('[WEBHOOK_EVENT_TIME_VIOLATION]', {
          integration: job.integration,
          eventType: job.eventType,
          eventId: job.eventId,
        });

        throw new Error('[EVENT_TIME_VIOLATION] webhook missing canonical event time');
      }

      const result = await trx('domain_events')
        .insert({
          shop_id: envelope.shopId,
          event_type: `webhook/${job.eventType}`,
          event_payload: job,
          event_time: new Date(canonicalEventTime),
          event_version: 1,
          external_event_id: externalEventId,
        })
        .onConflict(['shop_id', 'external_event_id'])
        .ignore()
        .returning(['id']);

      /**
       * DOMAIN EVENT IDEMPOTENCY GUARD (CRITICAL)
       * ----------------------------------------
       * Guarantees:
       * - exactly one domain_event per external event
       * - replay-safe ingestion
       * - prevents duplicate projections
       */
      if (!result || result.length === 0) {
        console.warn('[DOMAIN_EVENT_DUPLICATE_IGNORED]', {
          shopId: envelope.shopId,
          externalEventId,
          eventType: job.eventType,
        });
        return;
      }

      const [event] = result;

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