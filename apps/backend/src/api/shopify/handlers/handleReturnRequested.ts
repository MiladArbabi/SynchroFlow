import db from 'api-src/db';
import { getQueueChannel } from 'api-src/queue';
import { WebhookEnvelope } from 'api-src/api/webhooks/types';

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
  const channel = getQueueChannel('returns.ingestion');

  const [staged] = await db('staged_events')
    .insert({
      source_platform: 'shopify',
      event_type: 'returns/requested',
      raw_payload: rawPayload,
      shop_id: shopId,
    })
    .returning<{ id: number }[]>('id');

  channel.sendToQueue(
    'returns.ingestion',
    Buffer.from(JSON.stringify({ staged_event_id: staged.id })),
  );
}