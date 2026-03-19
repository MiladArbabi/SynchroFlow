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

  /**
   * INDEPENDENT EVALUATOR EXECUTION
   * --------------------------------
   * Each constraint must be isolated.
   * Failure in one MUST NOT affect others.
   */

  /**
   * DESIGN INVARIANT:
   * -----------------
   * Constraint evaluators must be:
   * - independent
   * - failure-isolated
   *
   * Never nest evaluators.
   * Never allow one constraint to suppress another.
   */

  //
  // INVENTORY
  //
  try {
    const inventory = await evaluateInventoryConstraint(
      trx,
      orderId,
      shopId
    );
    results.push(inventory);
  } catch (error) {
    console.error('[CONSTRAINT_ENGINE_EVALUATOR_FAILURE]', {
      orderId,
      shopId,
      evaluator: 'inventory',
      error
    });
    results.push({ type: 'inventory', isActive: false });
  }

  //
  // CUSTOMER
  //
  try {
    const customer = await evaluateCustomerConstraint(
      trx,
      orderId,
      shopId
    );
    results.push(customer);
  } catch (error) {
    console.error('[CONSTRAINT_ENGINE_EVALUATOR_FAILURE]', {
      orderId,
      shopId,
      evaluator: 'customer',
      error
    });
    results.push({ type: 'customer', isActive: false });
  }

  //
  // OPERATIONAL
  //
  try {
    const operational = await evaluateOperationalConstraint(
      trx,
      orderId,
      shopId
    );
    results.push(operational);
  } catch (error) {
    console.error('[CONSTRAINT_ENGINE_EVALUATOR_FAILURE]', {
      orderId,
      shopId,
      evaluator: 'operational',
      error
    });
    results.push({ type: 'operational', isActive: false });
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