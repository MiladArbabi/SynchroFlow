// apps/backend/src/queues/reconciliation.queue.ts

import { getQueueChannel } from "../queue.js";

/**
 * Fulfillment Reconciliation Queue (Sovereign UUID Contract)
 * -----------------------------------------------------------
 * - One job = one lasyncro_order_id
 * - Idempotent
 * - Safe to retry
 */

export const RECONCILIATION_QUEUE = 'fulfillment.reconciliation';

/**
 * QUEUE CONTRACT (STRICT)
 * ------------------------
 * Payload MUST include:
 * - lasyncroOrderId
 * - aggregateVersion (required)
 * - observed (optional)
 *
 * Consumer enforces strict version gate.
 * Any contract deviation will be dead-lettered.
 */
export async function publishReconciliationJob(
  lasyncroOrderId: string,
  aggregateVersion: number,
  observed?: {
    status: 'fulfilled';
    observedAt: Date;
    source: 'shopify_sync';
  }
) {
  const ch = getQueueChannel(RECONCILIATION_QUEUE);

  const payload = Buffer.from(
    JSON.stringify({ lasyncroOrderId, aggregateVersion, observed })
  );

  /**
   * DURABILITY LIMITATION (IMPORTANT)
   * ---------------------------------
   * sendToQueue() boolean ONLY indicates buffer acceptance,
   * NOT broker persistence or replication.
   *
   * This system currently operates in:
   * - at-least-once delivery (best effort)
   * - NOT guaranteed durability (no confirm channel)
   *
   * Future requirement:
   * - migrate to confirm channel OR transactional outbox relay
   */
  const result = await ch.sendToQueue(
    RECONCILIATION_QUEUE,
    payload,
    { persistent: true }
  );

  if (!result) {

    console.error('[QUEUE_BACKPRESSURE]', {
      queue: RECONCILIATION_QUEUE,
      order: lasyncroOrderId
    });
    
    throw new Error(
      `[reconciliation.queue] Failed to publish reconciliation job for ${lasyncroOrderId}`
    );
  }
}
