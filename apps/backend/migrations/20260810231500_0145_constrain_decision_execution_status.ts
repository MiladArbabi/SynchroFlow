import { Knex } from 'knex';

/**
 * EXEC-STATUS-01 — constrain decision_execution_queue.status
 * ----------------------------------------------------------
 * The column was a bare varchar with no CHECK, no enum and no default,
 * written by four live paths:
 *
 *   pending      orders.execute.controller, execution.worker (manual skip
 *                re-insert), reconciliation.handlers
 *   dispatched   execution.dispatcher.worker
 *   in_progress  commands.consumer
 *   success      commands.consumer, execution.worker
 *   failure      execution.worker
 *
 * A sixth value, 'failed', existed only in manualExecution.service.ts —
 * deleted in this same change (EXEC-STATUS-01). That service threw
 * MANUAL_EXECUTION_DISABLED on its first statement, had zero importers,
 * and its ~130 unreachable lines carried a second stale vocabulary
 * ('executed', MANUAL_EXECUTION_INVALID_STATE). Its stated replacement —
 * reintroduction through the Command Bus — already shipped as
 * EXECUTE_DECISION in commands.consumer.ts. The live reader
 * (execution.guard.ts) matches 'failure'; a future reader written
 * against 'failed' would have silently matched no rows. This makes that
 * class of typo fail at the database instead.
 *
 * NOT addressed here (EXEC-STALL-01): 'dispatched' and 'in_progress' have
 * no recovery path. list_pending_decision_executions selects only
 * 'pending', and execution.guard blocks only on 'success'/'failure', so a
 * row stranded by a worker restart or DLQ is invisible and unrecoverable.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.decision_execution_queue
      ADD CONSTRAINT decision_execution_queue_status_check
      CHECK (status IN ('pending','dispatched','in_progress','success','failure'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    ALTER TABLE public.decision_execution_queue
      DROP CONSTRAINT IF EXISTS decision_execution_queue_status_check
  `);
}
