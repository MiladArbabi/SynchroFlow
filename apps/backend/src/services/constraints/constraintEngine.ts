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
    const inventoryResults = await evaluateInventoryConstraint(
      trx,
      orderId,
      shopId
    );

    /**
     * SUPPORT MULTI-RESULT EVALUATORS
     * -------------------------------
     * Inventory constraints are variant-scoped.
     */
    results.push(...inventoryResults);
  } catch (error) {
    console.error('[CONSTRAINT_ENGINE_EVALUATOR_FAILURE]', {
      orderId,
      shopId,
      evaluator: 'inventory',
      error
    });
    /**
     * Fallback must still emit a single inactive placeholder
     * to preserve deterministic coverage.
     */
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

    if (type === 'inventory') {
      console.error('[CONSTRAINT_ENGINE_SCOPE_VIOLATION]', {
        orderId,
        type,
        reason: 'attempted to synthesize inventory constraint without targetId'
      });
      
      continue;
    }

    if (!results.find(r => r.type === type)) {

      results.push({
        type,
        isActive: false
      });
    }
  }

  /**
   * CONSTRAINT ENGINE TRACE
   * -----------------------
   * Emits full evaluation snapshot.
   *
   * Required for:
   * - debugging fragmented persistence
   * - validating projection alignment
   * - future consolidation into single write path
   */
  /* console.info('[CONSTRAINT_ENGINE_RESULT]', {
    orderId,
    shopId,
    results
  }); */

  return results;
}