import { Knex } from 'knex';
import { ConstraintEvaluationResult } from '../constraint.types.js';

/**
 * CUSTOMER CONSTRAINT EVALUATOR
 * -----------------------------
 * Detects orders blocked by customer-side dependency.
 *
 * Current definition:
 * - active customer constraint event exists
 *
 * Future extensions:
 * - missing address
 * - failed delivery validation
 * - customer confirmation required
 */
export async function evaluateCustomerConstraint(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number
): Promise<ConstraintEvaluationResult> {

  /**
   * CUSTOMER CONSTRAINT SIGNAL
   * --------------------------------
   * Source of truth:
   * order_fulfillment_status.customer_block_type
   *
   * This is produced by reconciliation / obligation evaluation.
   *
   * Deterministic:
   * - read-only
   * - no projection dependency
   */

  const fulfillment = await trx('order_fulfillment_status')
    .where({ lasyncro_order_id: orderId })
    .first();

  const isBlocked = !!fulfillment?.customer_block_type;

  console.debug('[CUSTOMER_CONSTRAINT_EVALUATED]', {
    orderId,
    shopId,
    isBlocked
  });

  return {
    type: 'customer',
    isActive: isBlocked
  };
}