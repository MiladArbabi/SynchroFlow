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
   * orderInventoryConstraintProjection
   */

  const constraint = await trx('order_constraints')
    .where({
      lasyncro_order_id: orderId,
      constraint_type: 'inventory',
      is_active: true
    })
    .first();

  return {
    type: 'inventory',
    isActive: !!constraint,
    meta: {
      blockType: constraint?.block_type ?? null
    }
  };
}