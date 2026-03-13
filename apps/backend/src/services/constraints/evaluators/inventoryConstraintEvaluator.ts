/**
 * Inventory Constraint Evaluator
 * -------------------------------
 *
 * Emits the inventory constraint signal used by the
 * Constraint Emission Layer.
 *
 * Source of truth:
 * order_fulfillment_status.inventory_block_type
 *
 * This field is produced by:
 * services/order-execution-intelligence/obligationFlags.worker.ts
 *
 * The constraint engine must NOT recompute inventory math
 * from the inventory projection layer. Doing so would duplicate logic and
 * create multiple sources of truth.
 *
 * Deterministic:
 * - read-only
 * - side-effect free
 */

import { Knex } from 'knex';
import { ConstraintEvaluationResult } from '../constraint.types.js';

export async function evaluateInventoryConstraint(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number
): Promise<ConstraintEvaluationResult> {

  /**
   * Inventory constraint signal
   * ---------------------------
   * Source of truth is fulfillment obligation evaluation.
   *
   * inventory_block_type is set by:
   * order-execution-intelligence/obligationFlags.worker
   */

  const fulfillment = await trx('order_fulfillment_status')
    .where({ lasyncro_order_id: orderId })
    .first();

  const isBlocked = !!fulfillment?.inventory_block_type;

  return {
    type: 'inventory',
    isActive: isBlocked
  };
}