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

/**
 * CONTROL LOOP THROTTLE
 * ---------------------
 * 1s polling causes burst re-enqueue even with DB guards.
 * Increase interval to align with SLA granularity.
 */
const POLL_INTERVAL_MS = 10000; // 10s

/**
 * DISPATCH LOOP GUARD
 * -------------------
 * Prevent overlapping executions caused by async setInterval.
 * Guarantees single in-flight dispatcher loop.
 */
let isRunning = false;

export async function startReconciliationIntentDispatcher() {

  console.log('[reconciliation-intent-dispatcher] starting...');

  const lock = await db.raw(`SELECT pg_try_advisory_lock(918273645)`);

  if (!lock.rows[0].pg_try_advisory_lock) {
    console.warn('[reconciliation-intent-dispatcher] not started (lock held by another instance)');
    return;
  }

  console.log('[reconciliation-intent-dispatcher] started (lock acquired)');

  setInterval(async () => {

    if (isRunning) {
      console.warn('[reconciliation-intent-dispatcher] skipped overlapping tick');
      return;
    }

    isRunning = true;

    try {
      // TIME-DRIVEN RECONCILIATION (SLA SUPPORT)
      // ----------------------------------------
      // Re-enqueue pending, unfulfilled orders to allow
      // time-based constraints (e.g. SLA) to evolve

      const staleOrders = await db('orders as o')
        .join('order_fulfillment_status as ofs', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
        .where('ofs.status', 'pending')
        .whereNull('ofs.fulfilled_at')
        .whereRaw('o.aggregate_version >= o.last_projected_version')
        .whereRaw(`
          (
            o.last_reconciled_at IS NULL
            OR o.last_reconciled_at < NOW() - INTERVAL '5 minutes'
          )
        `)
        .select('o.lasyncro_order_id', 'o.aggregate_version')
        .limit(50);

      let insertedCount = 0;

      for (const row of staleOrders) {
        const result = await db('order_reconciliation_intents')
          .insert({
            lasyncro_order_id: row.lasyncro_order_id,
            aggregate_version: row.aggregate_version,
            observed: null,
            created_at: new Date()
          })
          .onConflict(['lasyncro_order_id', 'aggregate_version'])
          .ignore()
          .returning('reconciliation_intent_id');

        if (result.length > 0) insertedCount++;
      }

      if (insertedCount > 0) {
        console.debug('[TIME_DRIVEN_RECONCILIATION_ENQUEUED]', {
          inserted: insertedCount
        });
      }
        
      
      /**
       * LOCK INTENT ROWS
       * -----------------
       * Prevent concurrent dispatchers from double-processing.
       */
      const intents = await db.transaction(async (trx) => {
        /**
         * PRIORITY-BASED DISPATCH
         * ------------------------
         * Orders with active operational constraints (SLA breach)
         * must be processed first.
         *
         * Priority:
         * 1. SLA breach (operational_block_type = 'sla_breach')
         * 2. Others (FIFO fallback)
         *
         * NOTE:
         * This is the first step toward a constraint-driven execution engine.
         */
        const rows = await trx('order_reconciliation_intents as ori')
          .innerJoin('orders as o', 'o.lasyncro_order_id', 'ori.lasyncro_order_id')
          /**
           * VERSION GATE (CORRECTED)
           * ------------------------
           * Must allow equal version reconciliation.
           * Projection may advance last_projected_version before reconciliation.
           */
          .whereRaw('ori.aggregate_version >= o.last_projected_version')
          .select('ori.*')
          .orderBy('ori.created_at', 'asc') // temporary (no priority yet)
          .limit(10)
          .forUpdate()
          .skipLocked();

        return rows;
      });

      /**
       * APPLY PRIORITY AFTER LOCK (SAFE)
       * --------------------------------
       * We must NOT mix joins with FOR UPDATE.
       * Priority is derived after rows are locked.
       */
      const prioritized = await db('order_reconciliation_intents as ori')
        .leftJoin(
          'order_fulfillment_status as ofs',
          'ofs.lasyncro_order_id',
          'ori.lasyncro_order_id'
        )
        .whereIn(
          'ori.reconciliation_intent_id',
          intents.map(i => i.reconciliation_intent_id)
        )
        .select('ori.*')
        .orderByRaw(`
          CASE 
            WHEN ofs.operational_block_type = 'sla_breach' THEN 0
            ELSE 1
          END
        `)
        .orderBy('ori.created_at', 'asc');

      if (prioritized.length > 0) {
        console.debug('[PRIORITY_ORDER]', prioritized.map(p => p.lasyncro_order_id));
      }

      for (const intent of prioritized) {
        try {
          await publishReconciliationJob(
            intent.lasyncro_order_id,
            intent.aggregate_version,
            intent.observed ?? undefined
          );

          console.debug('[DISPATCH_ORDER]', {
            order: intent.lasyncro_order_id
          });

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
    } finally {
      isRunning = false;
    }
  }, POLL_INTERVAL_MS);
}