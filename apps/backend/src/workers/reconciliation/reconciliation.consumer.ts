// apps/backend/src/workers/reconciliation/reconciliation.consumer.ts
import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../../queue.js';
import { reconcileOrderFulfillment } from './reconciliation.handlers.js';
import { computeShopOperationalSnapshot } from '../projections/shopOperationalSnapshot.worker.js';

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

    /**
     * INVARIANT: STRICT SINGLE-FLIGHT PROCESSING
     * -------------------------------------------
     * Must remain 1 to preserve deterministic ordering guarantees.
     * Changing this breaks projection monotonicity assumptions.
     */
    channel.prefetch(1),
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

      if (typeof aggregateVersion !== 'number') {
        console.error('[reconciliation] invalid aggregateVersion type');
        ch.ack(msg);
        return;
      }

      /**
       * STRICT VERSION GATE (Queue Boundary)
       * -------------------------------------
       * Prevents:
       * - Stale event execution
       * - Duplicate projection
       * - Projection ahead of aggregate
       *
       * Structural invariants are DB-enforced,
       * but we fail fast here for operational clarity.
       */
      if (
        aggregateVersion !== order.aggregate_version ||
        aggregateVersion <= order.last_projected_version
      ) {
        /* console.warn(
          `[reconciliation] version gate blocked: order=${lasyncroOrderId} eventVersion=${aggregateVersion} current=${order.aggregate_version} projected=${order.last_projected_version}`
        ); */
        ch.ack(msg);
        return;
      }

      /**
       * SOURCE NORMALIZATION
       * --------------------
       * Historical ingestion pipelines produced `orders/sync`.
       * Reconciliation engine expects canonical source `shopify_sync`.
       *
       * Normalize here to preserve backward compatibility
       * and deterministic rebuild behavior.
       */
      const normalizedObserved = observed
        ? {
            ...observed,
            source: 'shopify_sync',
            observedAt: new Date(observed.observedAt),
          }
        : undefined;

      await reconcileOrderFulfillment(
        lasyncroOrderId,
        aggregateVersion,
        normalizedObserved
      );

      /**
       * SHOP SNAPSHOT RECOMPUTATION
       * ---------------------------
       * Executed after reconciliation completes.
       *
       * This guarantees:
       * - Full shop state evaluation
       * - No partial-state snapshots
       * - Deterministic rebuild compatibility
       */
      const shopRow = await db('orders')
        .where({ lasyncro_order_id: lasyncroOrderId })
        .select('shop_id')
        .first();

      if (!shopRow?.shop_id) {
        throw new Error('[SNAPSHOT_INVARIANT] shop_id missing for order');
      }

      await computeShopOperationalSnapshot(shopRow.shop_id);

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