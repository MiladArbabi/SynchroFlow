// apps/backend/src/workers/reconciliation/reconciliation.consumer.ts
import { getQueueChannel } from '../../queue.js';
import { reconcileOrderFulfillment } from './reconciliation.handlers.js';

const QUEUE = 'fulfillment.reconciliation';

export function startReconciliationConsumer() {
  const ch = getQueueChannel(QUEUE);

  ch.addSetup((channel) => {
    console.log('[reconciliation] topology setup executing');
    return Promise.all([
    // 1. Dead-letter exchange
    channel.assertExchange(
      'fulfillment.reconciliation.dlx',
      'direct',
      { durable: true }
    ),

    // 2. Dead-letter queue
    channel.assertQueue(
      'fulfillment.reconciliation.dlq',
      { durable: true }
    ),

    channel.bindQueue(
      'fulfillment.reconciliation.dlq',
      'fulfillment.reconciliation.dlx',
      'dead'
    ),

    // 3. Main queue with DLX
    channel.assertQueue(QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'fulfillment.reconciliation.dlx',
        'x-dead-letter-routing-key': 'dead',
      },
    }),

    channel.prefetch(5),
  ]);
  });

  ch.consume(QUEUE, async (msg) => {
    if (!msg) return;

    try {
      const { lasyncroOrderId, observed } = JSON.parse(
        msg.content.toString()
      );

      /**
       * ECONOMIC AUTHORITY COMPLETE
       * ---------------------------
       * Projection and obligation recomputation
       * now occur inside reconciliation transaction.
       *
       * Consumer is transport-layer only.
       */
      
      const { affectedVariantIds } =
      await reconcileOrderFulfillment(lasyncroOrderId, observed);

      // Ack only after full economic + execution consistency
      ch.ack(msg);
    } catch (err) {
      console.error('[reconciliation] failed', err);

      const headers = msg.properties.headers || {};
      const retryCount = Number(headers['x-retry-count'] || 0);

      if (retryCount >= 3) {
        console.error('[reconciliation] permanently failed after 3 retries');
        ch.nack(msg, false, false); // drop after bounded retries
        return;
      }

      // Requeue with incremented retry count
      ch.sendToQueue(
        QUEUE,
        msg.content,
        {
          persistent: true,
          headers: {
            ...headers,
            'x-retry-count': retryCount + 1,
          },
        }
      );

      ch.ack(msg); // acknowledge original
    }

  });
}
