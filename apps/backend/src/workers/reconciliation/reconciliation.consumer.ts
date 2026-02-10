// apps/backend/src/workers/reconciliation/reconciliation.consumer.ts

import { getQueueChannel } from 'api-src/queue';
import { reconcileOrderFulfillment } from './reconciliation.handlers';

const QUEUE = 'fulfillment.reconciliation';

export function startReconciliationConsumer() {
  const ch = getQueueChannel(QUEUE);

  ch.addSetup((channel) => {
    return Promise.all([
        channel.assertQueue(QUEUE, { durable: true }),
        channel.prefetch(5), // prevent DB overload
    ]);
  });

  ch.consume(QUEUE, async (msg) => {
    console.log('[RECONSUMER] job received', msg.content.toString());

    if (!msg) return;

    try {
      const { canonicalOrderId, observed } = JSON.parse(
        msg.content.toString()
      );

      await reconcileOrderFulfillment(canonicalOrderId, observed);

      ch.ack(msg);
    } catch (err) {
      console.error('[reconciliation] failed', err);
      ch.nack(msg, false, false); // DLQ later
    }
  });
}
