import db from '@lasyncro/backend-core/db.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';

/**
 * Shopify returns/requested webhook handler.
 *
 * Responsibilities:
 * - Persist webhook envelope (idempotent at DB boundary)
 * - Stage raw payload for downstream ingestion
 * - Enqueue returns ingestion worker
 *
 * No parsing. No inference.
 */
export async function handleReturnRequested(
  envelope: WebhookEnvelope
): Promise<void> {

  const { shopId, rawPayload } = envelope;

  /**
   * INGESTION IDENTITY ENFORCEMENT
   */
  if (!envelope.eventId) {
    throw new Error(
      '[INGESTION_IDENTITY_VIOLATION] Missing external eventId'
    );
  }

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   */
  const createdAt = (rawPayload as any)?.created_at;

  if (!createdAt) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Return missing event_time at ingestion'
    );
  }

  let domainEventId: number;

  try {

    const result = await db('domain_events')
      .insert({
        shop_id: shopId,
        event_type: 'returns/requested',
        event_payload: rawPayload,
        event_time: new Date(createdAt),
        event_version: 1,
        external_event_id: envelope.eventId,
      })
      .returning('id');

    domainEventId = result[0].id ?? result[0];

  } catch (error: any) {

    /**
     * DUPLICATE DELIVERY HANDLING
     * ---------------------------
     * Unique constraint:
     * (shop_id, external_event_id)
     */
    if (error?.code === '23505') {

      console.warn('[DOMAIN_EVENT_DUPLICATE]', {
        shopId,
        externalEventId: envelope.eventId,
        eventType: 'returns/requested',
      });

      return; // Do NOT enqueue duplicate
    }

    throw error;
  }
}