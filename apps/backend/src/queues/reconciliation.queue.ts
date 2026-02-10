// NEW FILE
// apps/backend/src/queues/reconciliation.queue.ts

import { getQueueChannel } from 'api-src/queue';

/**
 * Fulfillment Reconciliation Queue
 * --------------------------------
 * Purpose:
 * - Drive synthetic fulfillment backfill
 * - Decouple reconciliation from request paths
 *
 * Contract:
 * - Idempotent jobs
 * - Safe to retry
 * - One job = one canonical_order_id
 */

export const RECONCILIATION_QUEUE = 'fulfillment.reconciliation';

export async function publishReconciliationJob(
  canonicalOrderId: string,
  observed?: {
    status: 'delivered';
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
    Buffer.from(JSON.stringify({ canonicalOrderId, observed })),
    { persistent: true }
  );
}