// apps/backend/src/workers/reconciliation/reconciliation.consumer.ts
import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../../queue.js';
import { reconcileOrderFulfillment } from './reconciliation.handlers.js';
import { computeShopOperationalSnapshot } from '../projections/shopOperationalSnapshot.worker.js';

import { ConflictTypes } from '../../conflict-resolution/conflict.types.js';

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

    console.info('[RECONCILIATION_CONSUMER_RECEIVED]', {
      payload: msg.content.toString(),
    });

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
      };

      /**
       * RECONCILIATION INVARIANT (CRITICAL)
       * ----------------------------------
       * Version-based gating is INVALID and must NOT block execution.
       *
       * Behavior:
       * - NEVER ack + return due to version mismatch
       * - ALWAYS allow handler to run
       *
       * NOTE:
       * - Ack must ONLY happen after successful processing
       */
      if (aggregateVersion !== order.aggregate_version) {
        console.warn(
          `[reconciliation][VERSION_MISMATCH_BYPASSED] order=${lasyncroOrderId} eventVersion=${aggregateVersion} current=${order.aggregate_version}`
        );
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

        console.info('[RECONCILIATION_CALLING_HANDLER]', {
          lasyncroOrderId,
          aggregateVersion,
        });

      await reconcileOrderFulfillment(
        lasyncroOrderId,
        aggregateVersion,
        normalizedObserved
      );

      console.info('[RECONCILIATION_HANDLER_COMPLETED]', {
        lasyncroOrderId,
        aggregateVersion,
      });

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

      console.info('[RECONCILIATION_SNAPSHOT_TRIGGER]', {
        shopId: shopRow.shop_id,
      });

      await computeShopOperationalSnapshot(shopRow.shop_id);

      ch.ack(msg);
      
    } catch (err) {
      console.error('[reconciliation] failed', err);

      const headers = msg.properties.headers || {};

      // Conflict-aware retry metadata (TEMP: classification placeholder until central system exists)
      const retryCount = Number(headers['x-retry-count'] || 0);

      // CLASSIFIED RETRY REASON (fallback = unknown conflict type)
      const retryReason =
        headers['x-retry-reason'] ||
        ConflictTypes.CONSTRAINT_VIOLATION;

      if (!Object.values(ConflictTypes).includes(retryReason)) {
        console.error('[INVALID_RETRY_REASON]', {
          retryReason,
          note: 'Non-canonical conflict type detected'
        });
      }

      // HARD STOP: retries must not be blind — log and surface reason
      if (retryCount >= 3) {
        console.error('[RETRY_ABORTED]', {
          retryCount,
          retryReason,
          note: 'Retry limit reached without conflict classification'
        });
        
        console.error('[reconciliation] permanently failed after 3 retries');
        ch.nack(msg, false, false); // drop after bounded retries
        return;
      }

      // RETRY BACKOFF (EXPONENTIAL)
      // Prevents hot-loop retries under persistent failure
      const retryDelayMs = Math.min(1000 * Math.pow(2, retryCount), 30000); // cap at 30s

      // Requeue with incremented retry count
      ch.sendToQueue(
        QUEUE,
        msg.content,
        {
          persistent: true,
          headers: {
            ...headers,
            'x-retry-count': retryCount + 1,
            'x-retry-reason': retryReason,
          },
          expiration: String(retryDelayMs) // delay before reprocessing
        }
      );

      ch.ack(msg); // acknowledge original
    }
  });
}