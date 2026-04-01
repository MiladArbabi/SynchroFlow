/**
 * resolve_customer_block HANDLER
 * -------------------------------
 * Handles customer-related blocking decisions.
 *
 * CURRENT:
 * - Manual action → no system-side execution
 *
 * PURPOSE:
 * - Prevent execution failure
 * - Maintain lifecycle consistency
 */
import { ExecutionHandler } from '../execution.registry.js';

export const resolveCustomerBlockHandler: ExecutionHandler = async (job) => {
  console.info('[HANDLER_EXECUTION]', {
    action: 'resolve_customer_block',
    decision_id: job.decision_id,
    entity_id: job.entity_id,
    note: 'manual_action_noop'
  });
};