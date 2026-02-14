// apps/backend/src/queues/reconciliation.queue.ts

import { getQueueChannel } from 'api-src/queue';

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

  ch.addSetup((channel) =>
    channel.assertQueue(RECONCILIATION_QUEUE, { durable: true })
  );

  ch.sendToQueue(
    RECONCILIATION_QUEUE,
    Buffer.from(JSON.stringify({ lasyncroOrderId, observed })),
    { persistent: true }
  );
}
