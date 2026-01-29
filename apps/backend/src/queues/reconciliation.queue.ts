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

export function publishReconciliationJob(
  canonicalOrderId: string
) {
  const ch = getQueueChannel(RECONCILIATION_QUEUE);

  ch.sendToQueue(
    RECONCILIATION_QUEUE,
    Buffer.from(JSON.stringify({ canonicalOrderId })),
    { persistent: true }
  );
}
