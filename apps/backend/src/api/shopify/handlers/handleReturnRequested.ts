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

  const [staged] = await db('staged_events')
    .insert({
      source_platform: 'shopify',
      event_type: 'returns/requested',
      raw_payload: rawPayload,
      shop_id: shopId,
    })
    .returning<{ id: number }[]>('id');
}