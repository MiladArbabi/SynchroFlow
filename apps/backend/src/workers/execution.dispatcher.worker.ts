/**
 * EXECUTION DISPATCHER WORKER (CRITICAL BRIDGE)
 * --------------------------------------------
 * Bridges:
 *   decision_execution_queue (DB)
 *     → execution.jobs.v1 (RabbitMQ)
 *
 * Guarantees:
 * - DB remains source of truth
 * - At-least-once enqueue
 * - No silent execution gaps
 *
 * Polling model (phase 1):
 * - Simple + reliable
 * - Can be replaced with LISTEN/NOTIFY later
 */

import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { enqueueExecutionJob } from '../queues/execution.queue.js';

const POLL_INTERVAL_MS = 1000;

export async function startExecutionDispatcher() {
  console.info('[EXECUTION_DISPATCHER_STARTED]');

  while (true) {
    try {
        /**
         * SYSTEM QUERY — no tenant context required.
         * Dispatcher reads across all shops; RLS bypassed intentionally.
         */
        const pending = await systemQuery(
          db('decision_execution_queue')
            .where({ status: 'pending' })
            .limit(50)
        );

      for (const row of pending) {
        try {
        /**
         * LOAD DECISION (CRITICAL)
         * ------------------------
         * decision_execution_queue is NOT sufficient to build ExecutionJob.
         * Must hydrate from decisions table (same as manual execution).
         *
         * THREAD A-2 cont'd (2026-06-30): was systemQuery() — only skips
         * the app-level guard, not real RLS. decisions has the standard
         * strict policy (no permissive carve-out, unlike the queue table
         * above). row.shop_id is already known from the queue row just
         * read — use it to scope this read properly instead of adding
         * another split policy to a table with other, unaudited
         * consumers.
         */
          let decision: any;
          await db.transaction(async (trx) => {
            await trx.raw(`SET LOCAL app.current_tenant = '${row.shop_id}'`);
            decision = await trx('decisions')
              .where({ id: row.decision_id })
              .first();
          });

        if (!decision) {
        console.error('[EXECUTION_DISPATCH_DECISION_NOT_FOUND]', {
            decision_id: row.decision_id,
        });
        continue;
        }

        /**
         * MANUAL-MODE GUARD (THREAD A-2 cont'd, 2026-06-30)
         * ----------------------------------------------------
         * Real bug, found live: this dispatcher polls
         * decision_execution_queue WHERE status = 'pending' with no
         * awareness of execution_mode — 'pending' has always been
         * overloaded, meaning both "ready for automatic dispatch" and
         * "waiting for explicit manual trigger." Before tonight this
         * never mattered (manual rows were always inert — see the
         * execution.worker.ts EXECUTION_SKIPPED_MANUAL_MODE branch).
         * Now that EXECUTE_DECISION (commands.consumer.ts) actually
         * executes manual decisions for real, the two paths race over
         * the same row — confirmed live: a real DECISION_SUCCESS got
         * silently clobbered back to 'dispatched' by this path finishing
         * second. Manual decisions are now exclusively owned by the
         * EXECUTE_DECISION command path — skip them here entirely,
         * leave status untouched for that path to manage.
         */
        if (decision.recommended_action?.execution_mode === 'manual') {
          console.info('[EXECUTION_DISPATCH_SKIPPED_MANUAL]', {
            decision_id: row.decision_id,
          });
          continue;
        }

        /**
         * RECONSTRUCT EXECUTION JOB (CANONICAL)
         */
        const job = {
            decision_id: decision.id,
            entity_id: decision.entity_id,
            shop_id: decision.shop_id,
            aggregate_version: decision.aggregate_version,
            action_type: decision.recommended_action?.type,
            /**
             * PAYLOAD EXTRACTION (CRITICAL FIX)
             * --------------------------------
             * ExecutionJob.payload must NOT contain full action object.
             * Only pass action.payload.
             */
            payload: decision.recommended_action?.payload ?? {},
            execution_mode: decision.recommended_action?.execution_mode ?? 'automated',
        };

        /**
         * VALIDATION (FAIL FAST)
         */
        if (!job.action_type) {
        console.error('[EXECUTION_DISPATCH_INVALID_ACTION_TYPE]', {
            decision_id: decision.id,
        });
        continue;
        }

        await enqueueExecutionJob(job);

          /**
           * MARK AS DISPATCHED
           */
          // THREAD A-2 cont'd (2026-06-30): write needs real tenant
          // context now that this table has a strict write policy.
          // row.shop_id already known from the queue row.
          await db.transaction(async (trx) => {
            await trx.raw(`SET LOCAL app.current_tenant = '${row.shop_id}'`);
            await trx('decision_execution_queue')
              .where({ decision_id: row.decision_id })
              /**
               * DISPATCH STATE TRANSITION
               * -------------------------
               * dispatched = job has been enqueued to execution queue
               *
               * IMPORTANT:
               * - This is NOT execution
               * - DO NOT mutate executed_at here
               *
               * executed_at lifecycle:
               * - null → pending/dispatched
               * - set → execution completed (success or failure)
               */
              .update({
                status: 'dispatched',
                /**
                 * DO NOT set executed_at here.
                 * executed_at must represent ACTUAL execution completion time.
                 *
                 * Setting it here breaks:
                 * - observability (false execution timestamps)
                 * - debugging (cannot distinguish dispatched vs executed)
                 *
                 * executed_at is ONLY set by execution.worker on success/failure.
                 */
            })
        });
          

          console.info('[EXECUTION_DISPATCHED]', {
            decision_id: row.decision_id,
          });

        } catch (err) {
          console.error('[EXECUTION_DISPATCH_FAILED]', {
            decision_id: row.decision_id,
            error: (err as Error).message,
          });
        }
      }

    } catch (err) {
      console.error('[EXECUTION_DISPATCHER_LOOP_ERROR]', {
        error: (err as Error).message,
      });
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}