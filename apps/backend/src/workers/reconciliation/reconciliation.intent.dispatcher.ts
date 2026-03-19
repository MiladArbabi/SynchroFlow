import db from '@lasyncro/backend-core/db.js';
import { publishReconciliationJob } from '../../queues/reconciliation.queue.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * RECONCILIATION INTENT DISPATCHER
 * ---------------------------------
 * Responsible for:
 * - Polling versioned reconciliation intents
 * - Publishing to queue
 * - Deleting only after successful publish
 *
 * Guarantees:
 * - At-least-once dispatch
 * - Version monotonicity enforced by DB uniqueness
 * - Projection layer remains side-effect free
 */

const POLL_INTERVAL_MS = 1000;

export function startReconciliationIntentDispatcher() {
  console.log('[reconciliation-intent-dispatcher] started');

  setInterval(async () => {

    try {
      // TIME-DRIVEN RECONCILIATION (SLA SUPPORT)
      // ----------------------------------------
      // Re-enqueue pending, unfulfilled orders to allow
      // time-based constraints (e.g. SLA) to evolve

      const staleOrders = await db('order_fulfillment_status as ofs')
        .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
        .where('ofs.status', 'pending')
        .whereNull('ofs.fulfilled_at')
        .select('ofs.lasyncro_order_id', 'o.aggregate_version')
        .limit(50);

      for (const row of staleOrders) {
        await db('order_reconciliation_intents')
          .insert({
            lasyncro_order_id: row.lasyncro_order_id,
            aggregate_version: row.aggregate_version,
            observed: null,
            created_at: new Date()
          })
          .onConflict(['lasyncro_order_id', 'aggregate_version'])
          .ignore();
      }

      console.debug('[TIME_DRIVEN_RECONCILIATION_ENQUEUED]', {
        count: staleOrders.length
      });
      
      /**
       * LOCK INTENT ROWS
       * -----------------
       * Prevent concurrent dispatchers from double-processing.
       */
      const intents = await db.transaction(async (trx) => {
        const rows = await trx('order_reconciliation_intents')
          .select('*')
          .orderBy('created_at', 'asc')
          .limit(10)
          .forUpdate()
          .skipLocked();

        return rows;
      });

      for (const intent of intents) {
        try {
          await publishReconciliationJob(
            intent.lasyncro_order_id,
            intent.aggregate_version,
            intent.observed ?? undefined
          );

          /**
           * DELETE ONLY AFTER SUCCESSFUL PUBLISH
           */
          await db('order_reconciliation_intents')
            .where({
              reconciliation_intent_id: intent.reconciliation_intent_id,
            })
            .delete();

        } catch (err) {
          console.error(
            '[reconciliation-intent-dispatcher] publish failed',
            err
          );
        }
      }

    } catch (err) {
      console.error(
        '[reconciliation-intent-dispatcher] polling failed',
        err
      );
    }
  }, POLL_INTERVAL_MS);
}