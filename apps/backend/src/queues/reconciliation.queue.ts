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

export async function publishReconciliationJob(
  lasyncroOrderId: string,
  observed?: {
    status: 'fulfilled';
    observedAt: Date;
    source: 'shopify_sync';
  }
) {
  const ch = getQueueChannel(RECONCILIATION_QUEUE);

  const payload = Buffer.from(
    JSON.stringify({ lasyncroOrderId, observed })
  );

  /**
   * CRITICAL DURABILITY GUARD
   * --------------------------
   * Await broker acceptance.
   * If publish fails, throw.
   * Upstream worker must not ack original event.
   */
  const result = await ch.sendToQueue(
    RECONCILIATION_QUEUE,
    payload,
    { persistent: true }
  );

  if (!result) {
    throw new Error(
      `[reconciliation.queue] Failed to publish reconciliation job for ${lasyncroOrderId}`
    );
  }
}
