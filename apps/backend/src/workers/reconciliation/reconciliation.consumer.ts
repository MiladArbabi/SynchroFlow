// apps/backend/src/workers/reconciliation/reconciliation.consumer.ts
import db from '@lasyncro/backend-core/db.js';
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
      const { lasyncroOrderId, aggregateVersion, observed } = JSON.parse(
        msg.content.toString()
      );

      /**
       * VERSION-BASED RECONCILIATION GATE
       * ---------------------------------
       * Reconciliation executes only for the current
       * aggregate_version of the order.
       *
       * Guarantees:
       * - Strict monotonic processing
       * - Stale event suppression
       * - Replay safety
       */
      const order = await db('orders')
        .where({ lasyncro_order_id: lasyncroOrderId })
        .select('aggregate_version', 'last_projected_version')
        .first();

      if (!order) {
        ch.ack(msg);
        return;
      }

      /**
       * STRICT VERSION PROJECTION GATE
       * --------------------------------
       * Reconcile only if:
       * - incoming version equals current aggregate version
       * - and has not yet been projected
       */
      if (
        typeof aggregateVersion !== 'number' ||
        aggregateVersion !== order.aggregate_version ||
        aggregateVersion <= order.last_projected_version
      ) {
        ch.ack(msg);
        return;
      }

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
