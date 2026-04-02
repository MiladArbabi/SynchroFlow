import db from '@lasyncro/backend-core/db.js';
import { executeJob } from '../../workers/execution.worker.js';
import { ExecutionJob } from '../../domain/decision/Decision.js';
import { withTenant } from '@lasyncro/backend-core/db.js';

/**
 * MANUAL EXECUTION SERVICE
 * ------------------------
 * Executes a pending decision from decision_execution_queue.
 *
 * Guarantees:
 * - only pending decisions can be executed
 * - idempotent via decision_id
 * - lifecycle tracked
 */
export async function executeManualDecision(decisionId: string) {

/**
 * TENANT RESOLUTION (SECURE)
 * --------------------------
 * Resolve shop_id WITHOUT exposing cross-tenant existence.
 *
 * NOTE:
 * - We only extract shop_id (no branching on existence)
 * - Final existence validation happens INSIDE withTenant
 */
const preRow = await db('decision_execution_queue')
  .select('shop_id')
  .where({ decision_id: decisionId })
  .first();

if (!preRow?.shop_id) {
  /**
   * NOTE:
   * - Do NOT reveal whether decision exists across tenants
   * - Uniform failure prevents enumeration attacks
   */
  throw new Error('[MANUAL_EXECUTION_NOT_FOUND]');
}

  /**
 * TENANT CONTEXT ENFORCEMENT (CRITICAL)
 * ------------------------------------
 * Ensures:
 * - RLS compliance
 * - isolation correctness
 * - prevents cross-tenant leakage
 */
return await withTenant(Number(preRow.shop_id), async (trx) => {

  const row = await trx('decision_execution_queue')
    .where({ decision_id: decisionId })
    .forUpdate()
    .first();

  if (!row) {
    throw new Error('[MANUAL_EXECUTION_NOT_FOUND]');
  }

  if (row.status !== 'pending') {
    throw new Error('[MANUAL_EXECUTION_INVALID_STATE]');
  }

  /**
 * STATE TRANSITION (CRITICAL)
 * ---------------------------
 * Prevents concurrent execution.
 *
 * Strategy:
 * - Move to 'in_progress' BEFORE execution
 * - Row is already locked via FOR UPDATE
 */
await trx('decision_execution_queue')
  .where({ decision_id: decisionId })
  .update({
    status: 'in_progress'
  });

  /**
   * LOAD DECISION
   */
  const decision = await trx('decisions')
    .where({ id: decisionId })
    .first();

  if (!decision) {
    throw new Error('[DECISION_NOT_FOUND]');
  }

  /**
   * RECONSTRUCT EXECUTION JOB
   */
  const job: ExecutionJob = {
    decision_id: decision.id,
    entity_id: decision.entity_id,
    action_type: decision.recommended_action?.type,
    payload: decision.recommended_action,
    execution_mode: 'manual',
    aggregate_version: decision.aggregate_version,
    shop_id: decision.shop_id
  };

  /**
   * VALIDATION (CRITICAL)
   * ---------------------
   * Prevents execution with malformed decision data.
   */
  if (!job.action_type) {
    throw new Error('[MANUAL_EXECUTION_INVALID_ACTION_TYPE]');
  }

/**
 * CRITICAL:
 * Pass trx to ensure:
 * - single atomic unit
 * - no partial execution
 * - consistent state with decision_execution_queue
 */
try {
  await executeJob(job, trx);

  /**
   * SUCCESS TRANSITION
   */
  await trx('decision_execution_queue')
    .where({ decision_id: decisionId })
    .update({
      status: 'executed',
      executed_at: db.fn.now()
    });

    } catch (err) {
        const errorMessage = (err as Error).message;

        /**
         * FAILURE TRANSITION (CRITICAL)
         * -----------------------------
         * Prevents stuck 'in_progress' state.
         * Enables retry + observability.
         */
        await trx('decision_execution_queue')
            .where({ decision_id: decisionId })
            .update({
            status: 'failed',
            error: errorMessage
            });

        throw err;
     }
  });
}