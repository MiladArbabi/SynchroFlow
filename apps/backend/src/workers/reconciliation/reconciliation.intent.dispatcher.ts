import db from '@lasyncro/backend-core/db.js';
import { publishReconciliationJob } from '../../queues/reconciliation.queue.js';

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
 * CONTROL LOOP STRATEGY
 * ---------------------
 * - Fast polling during cold start (no reconciled orders)
 * - Slow polling after system becomes active
 */
let POLL_INTERVAL_MS = 1000; // fast bootstrap (1s)

/**
 * DISPATCH LOOP GUARD
 * -------------------
 * Prevent overlapping executions caused by async setInterval.
 * Guarantees single in-flight dispatcher loop.
 */
let isRunning = false;

/**
 * RECONCILIATION THROTTLING (SYSTEM STABILITY)
 * ---------------------------------------------
 * Hard cap per dispatcher cycle.
 *
 * Prevents:
 * - event storms
 * - DB overload
 * - worker starvation
 */
const MAX_RECONCILIATION_BATCH = 25;
let idleCycles = 0;
let lastObservedState: 'idle' | 'active' | null = null;

export async function startReconciliationIntentDispatcher() {

  console.log('[reconciliation-intent-dispatcher] starting...');

  const lock = await db.raw(`SELECT pg_try_advisory_lock(918273645)`);

  if (!lock.rows[0].pg_try_advisory_lock) {
    console.warn('[reconciliation-intent-dispatcher] not started (lock held by another instance)');
    return;
  }

  console.log('[reconciliation-intent-dispatcher] started (lock acquired)');

  /**
   * DYNAMIC CONTROL LOOP
   * --------------------
   * Allows runtime interval adjustment.
   */
  async function loop() {

    if (isRunning) {
      console.warn('[reconciliation-intent-dispatcher] skipped overlapping tick');
      return; // DO NOT reschedule here
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
        /**
         * CRITICAL FIX — PREVENT INFINITE RE-ENQUEUE
         * ------------------------------------------
         * Do NOT enqueue if an intent already exists
         * for the same (order, version)
         */
        .whereNotExists(
          db('order_reconciliation_intents as ori')
            .whereRaw('ori.lasyncro_order_id = o.lasyncro_order_id')
            .whereRaw('ori.aggregate_version = o.aggregate_version')
        )
        .select('o.lasyncro_order_id', 'o.aggregate_version')
        .limit(MAX_RECONCILIATION_BATCH);

      const currentState = staleOrders.length > 0 ? 'active' : 'idle';

      if (currentState !== lastObservedState) {
        console.debug('[RECONCILIATION_STATE_CHANGE]', {
          state: currentState,
          staleCount: staleOrders.length
        });
        lastObservedState = currentState;
      }

      let insertedCount = 0;

      for (const row of staleOrders) {
        const result = await db('order_reconciliation_intents')
          .insert({
            lasyncro_order_id: row.lasyncro_order_id,
            aggregate_version: row.aggregate_version,
            observed: null,
            created_at: new Date()
          })
          /**
           * CONFLICT STRATEGY: IGNORE (INTENT DEDUP)
           * ----------------------------------------
           * This is NOT a projection.
           *
           * Purpose:
           * - ensure only one intent per (order, version)
           * - prevent duplicate reconciliation work
           *
           * Safe because:
           * - guarded by whereNotExists
           * - queue semantics tolerate duplicates prevention
           */
          .onConflict(['lasyncro_order_id', 'aggregate_version'])
          .ignore()
          .returning('reconciliation_intent_id');

        if (result.length > 0) {
          insertedCount++;
        } else {
          console.debug('[INTENT_DUPLICATE_SKIPPED]', {
            lasyncroOrderId: row.lasyncro_order_id,
            aggregateVersion: row.aggregate_version
          });
        }
      }

      /* if (insertedCount > 0) {
        console.debug('[TIME_DRIVEN_RECONCILIATION_ENQUEUED]', {
          inserted: insertedCount
        });
      } */

      /**
       * SWITCH TO STEADY STATE
       * ----------------------
       * Once system starts processing real work,
       * reduce polling pressure.
       */
      if (insertedCount > 0 && POLL_INTERVAL_MS !== 60000) {
        /* console.info('[DISPATCHER_MODE_SWITCH]', {
          from: 'bootstrap',
          to: 'steady-state'
        }); */
        POLL_INTERVAL_MS = 60000;
      };
      
      /**
       * LOCK INTENT ROWS
       * -----------------
       * Prevent concurrent dispatchers from double-processing.
       */
      const intents = await db.transaction(async (trx) => {

        /**
         * PRIORITY-BASED DISPATCH (PARTIAL)
         * ---------------------------------
         * Current limitation:
         * - Locking cannot include joins (Postgres constraint)
         * - Therefore, we select a FIFO window first, then prioritize
         *
         * Mitigation:
         * - Expanded selection window (50) reduces priority starvation
         *
         * Future:
         * - Move to fully constraint-driven selection at DB level
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
          /**
           * 🚨 HARD INVARIANT — DO NOT TOUCH 🚨
           *
           * This query MUST NOT reference any table except `ori` and `o`.
           * - No joins to order_fulfillment_status
           * - No ofs.*
           *
           * Reason:
           * FOR UPDATE SKIP LOCKED requires a single locking target.
           * Violating this WILL crash the dispatcher (Postgres 42P01).
           */
          .select('ori.*')
          /**
           * PRIORITY-AWARE SELECTION (PRE-LOCK)
           * -----------------------------------
           * NOTE:
           * We intentionally still lock first without join,
           * but expand selection window to allow meaningful prioritization later.
           */
          .orderBy('ori.created_at', 'asc')
          .limit(MAX_RECONCILIATION_BATCH) // expanded window to avoid priority starvation
          .forUpdate()
          .skipLocked();

          if (rows.length > 0) {
            /* console.debug('[RECONCILIATION_BATCH_SELECTED]', {
              selected: rows.length,
              limit: MAX_RECONCILIATION_BATCH
            }); */
          }

        return rows;
      });

      /**
       * EMPTY INTENT GUARD
       * -------------------
       * Prevent invalid WHERE IN () query.
       */
      if (intents.length === 0) {
        idleCycles++;

        /**
         * DYNAMIC BACKOFF (IDLE SYSTEM)
         * ------------------------------
         * Gradually slow polling when no work is present.
         */
        if (idleCycles >= 5) {
          POLL_INTERVAL_MS = Math.min(POLL_INTERVAL_MS * 2, 60000);

          /**
           * BACKOFF OBSERVABILITY (THRESHOLDED)
           * -----------------------------------
           * Avoid log spam during idle exponential backoff.
           * Only log at meaningful thresholds.
           */
          if (POLL_INTERVAL_MS >= 10000) {
            console.info('[RECONCILIATION_BACKOFF_STABLE]', {
              idleCycles,
              interval: POLL_INTERVAL_MS
            });
          }

          idleCycles = 0;
        }

        return;
      }

      /**
       * WORK DETECTED → RESET BACKOFF
       */
      idleCycles = 0;

      if (POLL_INTERVAL_MS !== 200) {
        /* console.debug('[RECONCILIATION_BACKOFF_RESET]', {
          from: POLL_INTERVAL_MS,
          to: 200
        }); */
        POLL_INTERVAL_MS = 200;
      }

      const ranked = db({ ori: 'order_reconciliation_intents' })
        .leftJoin('order_constraints as oc', function () {
          this.on('oc.lasyncro_order_id', '=', 'ori.lasyncro_order_id')
            .andOn('oc.is_active', '=', db.raw('true'));
        })
        .whereIn(
          'ori.reconciliation_intent_id',
          intents.map(i => i.reconciliation_intent_id)
        )
        .groupBy(
          'ori.reconciliation_intent_id',
          'ori.lasyncro_order_id',
          'ori.aggregate_version',
          'ori.created_at'
        )
        .select(
          'ori.reconciliation_intent_id',
          'ori.lasyncro_order_id',
          'ori.aggregate_version',
          'ori.created_at',
          db.raw(`
            MIN(
              CASE
                WHEN oc.constraint_type = 'operational' AND oc.block_type = 'sla_breach' THEN 0
                WHEN oc.constraint_type = 'inventory' AND oc.block_type = 'oversell' THEN 1
                WHEN oc.constraint_type = 'customer' AND oc.block_type = 'awaiting_payment' THEN 2
                WHEN oc.constraint_type = 'inventory' AND oc.block_type = 'allocation_pending' THEN 3
                ELSE 99
              END
            ) as priority_rank
          `)
        );

      const prioritized = await db
        .from(ranked.as('ranked'))
        .orderBy('priority_rank', 'asc')
        .orderBy('created_at', 'asc');

      if (intents.length === 10) {
        console.warn('[PRIORITY_WINDOW_LIMIT]', {
          message: 'Selection window may be too small for true prioritization'
        });
      }

      if (prioritized.length > 0) {
        /**
         * PRIORITY INVARIANT CHECK
         * ------------------------
         * Ensures ordering respects:
         * SLA → Inventory → Customer → Others
         */
        for (let i = 1; i < prioritized.length; i++) {
          const prev = prioritized[i - 1];
          const curr = prioritized[i];

          const prevRank = prev.priority_rank;
          const currRank = curr.priority_rank;

          if (currRank < prevRank) {
            console.error('[PRIORITY_INVARIANT_VIOLATION]', {
              prev,
              curr,
              prevRank,
              currRank
            });
          }
        }
        /* console.debug('[PRIORITY_ORDER]', prioritized.map(p => p.lasyncro_order_id)); */

        /**
         * PRIORITY BREAKDOWN (SOURCE-OF-TRUTH)
         * ------------------------------------
         * Uses unified constraint model instead of legacy columns.
         */
        const breakdown = await db('order_constraints')
          .whereIn(
            'lasyncro_order_id',
            prioritized.map(p => p.lasyncro_order_id)
          )
          .andWhere('is_active', true)
          .select(
            'lasyncro_order_id',
            'constraint_type',
            'block_type'
          );

        /* console.debug('[PRIORITY_BREAKDOWN]', breakdown); */
      }

      for (const intent of prioritized) {
        try {
          await publishReconciliationJob(
            intent.lasyncro_order_id,
            intent.aggregate_version,
            intent.observed ?? undefined
          );

          /* console.debug('[DISPATCH_ORDER]', {
            order: intent.lasyncro_order_id
          }); */

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
      setTimeout(loop, POLL_INTERVAL_MS);
    }
  }

  /**
   * START CONTROL LOOP
   * ------------------
   * Required to activate dispatcher.
   */
  loop();
}