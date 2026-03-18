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
import { evaluateCustomerConstraint } from './evaluators/customerConstraintEvaluator.js';
import { evaluateOperationalConstraint } from './evaluators/operationalConstraintEvaluator.js';

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

    /**
     * CUSTOMER CONSTRAINT EVALUATION
     * --------------------------------
     * Source-of-truth must NOT be constraint events.
     * Current implementation is transitional and will be replaced.
     *
     * Instrumentation:
     * Logs execution to ensure evaluator is not silently skipped.
     */
    try {

      const customer = await evaluateCustomerConstraint(
        trx,
        orderId,
        shopId
      );

      console.debug('[CONSTRAINT_ENGINE] customer_evaluated', {
        orderId,
        shopId,
        isActive: customer.isActive
      });

      results.push(customer);

          /**
     * OPERATIONAL CONSTRAINT EVALUATION
     * --------------------------------
     * Currently guarded (no source-of-truth).
     *
     * Instrumentation ensures visibility until real signal is implemented.
     */
    try {

      const operational = await evaluateOperationalConstraint(
        trx,
        orderId,
        shopId
      );

      console.debug('[CONSTRAINT_ENGINE] operational_evaluated', {
        orderId,
        shopId,
        isActive: operational.isActive
      });

      results.push(operational);

    } catch (error) {

      console.error(
        '[CONSTRAINT_ENGINE_EVALUATOR_FAILURE]',
        {
          orderId,
          shopId,
          evaluator: 'operational',
          error
        }
      );

      results.push({
        type: 'operational',
        isActive: false
      });

    }

    } catch (error) {

      console.error(
        '[CONSTRAINT_ENGINE_EVALUATOR_FAILURE]',
        {
          orderId,
          shopId,
          evaluator: 'customer',
          error
        }
      );

      results.push({
        type: 'customer',
        isActive: false
      });

    }

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