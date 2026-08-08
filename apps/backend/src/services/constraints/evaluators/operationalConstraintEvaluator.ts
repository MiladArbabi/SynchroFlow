import { Knex } from 'knex';
import { ConstraintEvaluationResult } from '../constraint.types.js';

/**
 * BL-01b — OPERATIONAL IS PRE-RELEASE ONLY.
 *
 * pick_exceptions are POST-release by construction: pick_exception_stage is
 * ('pick','pack'), reachable only after /wms/batch/release then /claim. An
 * order awaiting pool entry can therefore never legitimately hold one.
 *
 * Problem Center is the single owner of receive/stow/pick/pack/returns
 * exceptions (problem_center_source). Mirroring them into order_constraints
 * created a second representation that gated the Order Pool via the
 * whereNotExists(active constraint) predicate in wms.controller.ts, blocking
 * orders from release because of a problem that can only occur after release.
 *
 * This evaluator is now inert and RESERVED for genuine pre-release blockers
 * (carrier unable to collect/deliver, warehouse closed, etc.). Those require
 * a merchant-declared source and are tracked as separate issues.
 */
export async function evaluateOperationalConstraint(
  _trx: Knex.Transaction,
  _orderId: string,
  _shopId: number
): Promise<ConstraintEvaluationResult> {
  return { type: 'operational', isActive: false, meta: { blockType: null } };
}