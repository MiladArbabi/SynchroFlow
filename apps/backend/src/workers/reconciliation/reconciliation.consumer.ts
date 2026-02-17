// apps/backend/src/workers/reconciliation/reconciliation.consumer.ts
import { getQueueChannel } from '../../queue.js';
import { reconcileOrderFulfillment } from './reconciliation.handlers.js';

const QUEUE = 'fulfillment.reconciliation';

export function startReconciliationConsumer() {
  const ch = getQueueChannel(QUEUE);

  ch.addSetup((channel) => {
    return Promise.all([
      channel.assertQueue(QUEUE, { durable: true }),
      channel.prefetch(5),
    ]);
  });

  ch.consume(QUEUE, async (msg) => {
    if (!msg) return;

    try {
      const { lasyncroOrderId, observed } = JSON.parse(
        msg.content.toString()
      );

      await reconcileOrderFulfillment(lasyncroOrderId, observed);

      ch.ack(msg);
    } catch (err) {
      console.error('[reconciliation] failed', err);
      ch.nack(msg, false, false);
    }
  });
}
