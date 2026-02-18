// apps/backend/src/workers/reconciliation/reconciliation.consumer.ts
import { getQueueChannel } from '../../queue.js';
import { reconcileOrderFulfillment } from './reconciliation.handlers.js';
import { rebuildInventoryProjection } from '../../services/inventory/rebuildInventoryProjection.js';
import { computeObligationFlags } from '../../services/order-execution-intelligence/obligationFlags.worker.js';
import db from '@lasyncro/backend-core/db.js';

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

      // 1. Reconcile economic state
      await reconcileOrderFulfillment(lasyncroOrderId, observed);

      // 2. Fetch shop_id deterministically
      const order = await db('orders')
        .where({ lasyncro_order_id: lasyncroOrderId })
        .select('shop_id')
        .first();

      if (!order) {
        throw new Error(`Order not found after reconciliation: ${lasyncroOrderId}`);
      }

      // 3. Rebuild projection (deterministic replay-safe)
      await rebuildInventoryProjection();

      // 4. Recompute obligation flags for this shop
      await computeObligationFlags(order.shop_id);

      // 5. Ack only after full economic + execution consistency
      ch.ack(msg);
    } catch (err) {
      console.error('[reconciliation] failed', err);
      ch.nack(msg, false, false);
    }
  });
}
