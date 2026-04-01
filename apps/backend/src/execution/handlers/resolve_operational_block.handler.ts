/**
 * resolve_operational_block HANDLER
 * ---------------------------------
 * Handles operational blockage resolution.
 *
 * CURRENT:
 * - No-op (manual action placeholder)
 *
 * PURPOSE:
 * - Prevent execution failure for manual decisions
 * - Maintain consistent execution lifecycle tracking
 */
import { ExecutionHandler } from '../execution.registry.js';

export const resolveOperationalBlockHandler: ExecutionHandler = async (job) => {
  console.info('[HANDLER_EXECUTION]', {
    action: 'resolve_operational_block',
    decision_id: job.decision_id,
    entity_id: job.entity_id,
    note: 'manual_action_noop'
  });

  /**
   * NO-OP:
   * - Manual action → no system-side execution
   * - Still required to avoid handler lookup failure
   */
};