/**
 * DECISION → REQUIRED ACTIVE CONSTRAINT (ORD-DECISION-01)
 * -------------------------------------------------------
 * Single definition of which active order_constraints type a decision
 * action depends on in order to still be meaningful.
 *
 * WHY THIS IS SHARED, NOT DUPLICATED
 * ----------------------------------
 * order_constraints is the documented single source of truth
 * (constraint_system_blueprint.md); nothing guarantees `decisions` stays
 * in sync with it. A decision recommending resolve_{type}_block is STALE
 * the moment the matching constraint type has zero active rows.
 *
 * The read path (GET /orders/:orderId/decision) has filtered stale
 * decisions this way since 2026-07-02. The execute path did not, so an
 * order whose block had already cleared could still be POSTed to
 * /execute: the read model correctly showed nothing actionable while the
 * write model happily queued the stale action. Two models of the same
 * question, disagreeing.
 *
 * Both paths now import this map so the answer cannot drift. Adding an
 * action here makes it stale-checked on read AND on execute at once.
 *
 * An action ABSENT from this map has no constraint prerequisite and is
 * always executable — that is the deliberate default, and it is what
 * keeps returned_undelivered's open_return_job, proceed_fulfillment and
 * every other existing action behaving exactly as before.
 */
export const CONSTRAINT_TYPE_BY_ACTION: Record<string, string> = {
  resolve_inventory_block: 'inventory',
  resolve_customer_block: 'customer',
  resolve_operational_block: 'operational',
  open_return_job: 'operational',
};

/**
 * True when the action's required constraint type is still active for
 * the order, or when the action has no constraint prerequisite at all.
 *
 * `activeConstraintTypes` must contain ONLY currently-active
 * (is_active = true) constraint types for the order in question.
 */
export function isDecisionActionStillValid(
  actionType: string | undefined,
  activeConstraintTypes: readonly string[]
): boolean {
  if (!actionType) return true;

  const requiredType = CONSTRAINT_TYPE_BY_ACTION[actionType];
  if (!requiredType) return true;

  return activeConstraintTypes.includes(requiredType);
}
