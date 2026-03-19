import { Knex } from 'knex';
import { evaluateOperationalConstraint } from '../services/constraints/evaluators/operationalConstraintEvaluator.js';

/**
 * ORDER OPERATIONAL CONSTRAINT PROJECTION
 * ---------------------------------------
 * Source of truth: constraint engine (evaluator)
 *
 * Responsibilities:
 * - consume evaluator output
 * - persist operational_block_type
 *
 * MUST NOT:
 * - re-implement SLA logic
 *
 * Guarantees:
 * - deterministic
 * - evaluator-aligned
 * - no logic drift
 */
export async function projectOrderOperationalConstraints(
  trx: Knex.Transaction,
  orderIds: string[],
  shopId: number
): Promise<void> {

  if (orderIds.length === 0) return;

  const results = new Map<string, boolean>();

  /**
   * EVALUATION PHASE
   * ----------------
   * Single source-of-truth:
   * operationalConstraintEvaluator
   */
  for (const orderId of orderIds) {

    // PRE-CONDITION: fulfillment must exist
    const exists = await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: orderId })
      .first();

    if (!exists) {
      console.warn('[OPERATIONAL_PROJECTION_SKIPPED_NO_FULFILLMENT]', {
        orderId
      });
      continue;
    }

    const evaluation = await evaluateOperationalConstraint(
      trx,
      orderId,
      shopId
    );

    results.set(orderId, evaluation.isActive);
  }

  /**
   * WRITE PHASE
   * ------------
   * Persist evaluator-derived state only
   */
  for (const orderId of orderIds) {

    // EXPLICIT VISIBILITY: skipped write due to missing evaluation
    if (!results.has(orderId)) {
      console.warn('[OPERATIONAL_PROJECTION_WRITE_SKIPPED_NO_EVALUATION]', {
        orderId
      });
      continue;
    }

    const isBlocked = results.get(orderId) === true;

    const blockType = isBlocked
      ? 'sla_breach'
      : null;

    await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: orderId })
      .update({
        operational_block_type: blockType
      });
  }

  /**
   * OBSERVABILITY
   * --------------
   * Ensures projection is not silently failing
   */
  const blockedCount = Array.from(results.values()).filter(Boolean).length;

  console.debug('[operational_constraint_projection.completed]', {
    evaluated_orders: orderIds.length,
    blocked: blockedCount,
    source: 'constraint_engine'
  });
}