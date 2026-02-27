import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from 'queue.js';
import { WebhookEnvelope } from '../../../api/webhooks/types.js';

/**
 * Shopify returns/requested webhook handler.
 *
 * Responsibilities:
 * - Persist webhook envelope (idempotent)
 * - Stage raw payload for downstream ingestion
 * - Enqueue returns ingestion worker
 *
 * No parsing. No inference.
 */
export async function handleReturnRequested(envelope: WebhookEnvelope) {
  
  const { shopId, rawPayload } = envelope;

  /**
   * INGESTION EVENT-TIME ENFORCEMENT
   * ---------------------------------
   * Returns must carry canonical event-time.
   */
  if (!(rawPayload as any)?.created_at) {
    throw new Error(
      '[EVENT_TIME_VIOLATION] Return missing event_time at ingestion'
    );
  }

  /**
   * IMMUTABLE DOMAIN EVENT INSERT
   * -----------------------------
   * Append-only canonical event log.
   */
  const [domainEventId] = await db('domain_events')
    .insert({
      shop_id: shopId,
      event_type: 'returns/requested',
      event_payload: rawPayload,
      event_time: new Date((rawPayload as any).created_at),
      event_version: 1,
      event_sequence: db.raw(
        `
        COALESCE(
          (SELECT MAX(event_sequence) + 1
          FROM domain_events
          WHERE shop_id = ?),
          1
        )
        `,
        [shopId]
      ),
    })
    .returning('id');

  const finalDomainEventId =
    typeof domainEventId === 'object'
      ? domainEventId.id
      : domainEventId;

  getQueueChannel('events').sendToQueue(
    'events',
    Buffer.from(
      JSON.stringify({ domain_event_id: finalDomainEventId })
    )
  );
}