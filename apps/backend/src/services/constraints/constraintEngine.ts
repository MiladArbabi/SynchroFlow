/**
 * CONSTRAINT EVALUATION ENGINE
 * ----------------------------
 * Central deterministic evaluator for operational constraints.
 *
 * Responsibilities:
 * - evaluate system facts
 * - produce constraint evaluation results
 * - NEVER write to database
 *
 * DB writes are handled by projections only.
 */

import { Knex } from 'knex';
import { ConstraintEvaluationResult, ConstraintType } from './constraint.types.js';
import { evaluateInventoryConstraint } from './evaluators/inventoryConstraintEvaluator.js';

export async function evaluateOrderConstraints(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number
): Promise<ConstraintEvaluationResult[]> {

  /**
   * Constraint evaluator execution
   * --------------------------------
   * Evaluators must never crash the reconciliation pipeline.
   *
   * Failures are logged and treated as inactive constraints
   * to preserve deterministic reconciliation.
   */

  const results: ConstraintEvaluationResult[] = [];

  try {

    const inventory = await evaluateInventoryConstraint(
      trx,
      orderId,
      shopId
    );

    results.push(inventory);

  } catch (error) {

    console.error(
      '[CONSTRAINT_ENGINE_EVALUATOR_FAILURE]',
      {
        orderId,
        shopId,
        evaluator: 'inventory',
        error
      }
    );

    /**
     * Fail-safe behavior:
     * Treat evaluator failure as no constraint.
     */

    results.push({
      type: 'inventory',
      isActive: false
    });

  }

  /**
   * Ensure deterministic coverage of all constraint types.
   *
   * Without this guard, projections cannot resolve
   * previously active constraints for missing evaluators.
   */

  const requiredTypes: ConstraintType[] = [
    'inventory',
    'customer',
    'operational'
  ];

  for (const type of requiredTypes) {

    if (!results.find(r => r.type === type)) {

      results.push({
        type,
        isActive: false
      });

    }

  }

  return results;
}