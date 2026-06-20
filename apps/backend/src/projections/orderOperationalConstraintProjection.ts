import { Knex } from 'knex';
import { evaluateOperationalConstraint } from '../services/constraints/evaluators/operationalConstraintEvaluator.js';
import { v5 as uuidv5 } from 'uuid';
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

const CONSTRAINT_NAMESPACE = 'a9b7c6d4-4f8a-4c1b-b7b6-1c9a2e5d7f91';

export async function projectOrderOperationalConstraints(
  trx: Knex.Transaction,
  orderIds: string[],
  shopId: number
): Promise<void> {

  if (orderIds.length === 0) return;

  const results = new Map<string, string | null>();

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
      /* console.warn('[OPERATIONAL_PROJECTION_SKIPPED_NO_FULFILLMENT]', {
        orderId
      }); */
      continue;
    }

    const evaluation = await evaluateOperationalConstraint(
      trx,
      orderId,
      shopId
    );

    /**
     * Store the evaluator-derived blockType (or null if not blocked).
     * The evaluator now owns block classification (pick-exception based);
     * the projection no longer hardcodes 'sla_breach'.
     */
    results.set(orderId, (evaluation.meta?.blockType as string | null) ?? null);
  }

  /**
   * WRITE PHASE
   * ------------
   * Persist evaluator-derived state only
   */
  for (const orderId of orderIds) {

    // EXPLICIT VISIBILITY: skipped write due to missing evaluation
    /* if (!results.has(orderId)) {
      console.warn('[OPERATIONAL_PROJECTION_WRITE_SKIPPED_NO_EVALUATION]', {
        orderId
      });
      continue;
    } */

    const blockType = results.get(orderId) ?? null;
    const isBlocked = blockType !== null;;

    const constraintId = uuidv5(
      `operational:${orderId}`,
      CONSTRAINT_NAMESPACE
    );

    // update
    const updated = await trx('order_constraints')
      .where({
        lasyncro_order_id: orderId,
        constraint_type: 'operational'
      })
      .update({
        block_type: blockType,
        is_active: !!blockType,
        resolved_at: blockType ? null : new Date()
      });

    // insert if missing
    if (updated === 0) {
      await trx('order_constraints').insert({
        constraint_id: constraintId,
        lasyncro_order_id: orderId,
        constraint_type: 'operational',
        block_type: blockType,
        started_at: blockType ? new Date() : null,
        resolved_at: blockType ? null : new Date(),
        is_active: !!blockType,
        created_at: new Date()
      });
    }

    // logging
    /* if (blockType) {
      console.debug('[OPERATIONAL_BLOCK_ACTIVE]', {
        orderId,
        blockType
      });
    } */
  }

  /**
   * OBSERVABILITY
   * --------------
   * Ensures projection is not silently failing
   */
  const blockedCount = Array.from(results.values()).filter(Boolean).length;

  /* console.debug('[operational_constraint_projection.completed]', {
    evaluated_orders: orderIds.length,
    blocked: blockedCount,
    source: 'constraint_engine'
  }); */
}