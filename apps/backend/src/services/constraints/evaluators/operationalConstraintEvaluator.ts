import { Knex } from 'knex';
import { ConstraintEvaluationResult } from '../constraint.types.js';

/**
 * OPERATIONAL CONSTRAINT EVALUATOR
 * --------------------------------
 * Source of truth:
 * - pick_exceptions (unresolved physical fulfillment blockers)
 *
 * Definition:
 * - An order is operationally blocked when it has an UNRESOLVED pick
 *   exception — a physical problem that stops the order being picked/packed
 *   (item missing, short pick, product/packaging defect, wrong item).
 *
 * IMPORTANT — NOT SLA:
 * - Shipping-SLA breach is a TIME signal owned exclusively by
 *   order_age_snapshot.is_shipping_sla_breached → sla_breach alert.
 *   The operational constraint MUST NOT re-derive SLA timing; doing so
 *   produced two identical signals on the same orders. Operational is a
 *   PHYSICAL-blocker signal, orthogonal to age.
 *
 * Deterministic and replay-safe: depends only on persisted pick_exceptions.
 */

/**
 * Maps a pick_exception_type to a stable operational block_type.
 * order_cancelled is intentionally NOT a block (no action needed).
 */
const PICK_EXCEPTION_TO_BLOCK_TYPE: Record<string, string> = {
  item_missing:     'pick_item_missing',
  short_pick:       'pick_short',
  product_defect:   'product_defect',
  packaging_defect: 'packaging_defect',
  wrong_item:       'pick_wrong_item',
};

export async function evaluateOperationalConstraint(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number
): Promise<ConstraintEvaluationResult> {
  /**
   * Find the most relevant UNRESOLVED pick exception for this order.
   * pick_exceptions is line-item scoped, so we join up to the order via
   * order_line_items. order_cancelled is excluded — it is not an
   * actionable operational block.
   */
  const exceptionRow = await trx('pick_exceptions as pe')
    .join(
      'order_line_items as oli',
      'oli.lasyncro_line_item_id',
      'pe.lasyncro_line_item_id'
    )
    .where('oli.lasyncro_order_id', orderId)
    .where('pe.shop_id', shopId)
    .where('pe.resolved', false)
    .whereNot('pe.exception_type', 'order_cancelled')
    .orderBy('pe.created_at', 'asc')
    .select('pe.exception_type')
    .first();

  if (!exceptionRow) {
    return { type: 'operational', isActive: false, meta: { blockType: null } };
  }

  const blockType =
    PICK_EXCEPTION_TO_BLOCK_TYPE[exceptionRow.exception_type] ?? 'pick_exception';

  return {
    type: 'operational',
    isActive: true,
    meta: {
      /**
       * STANDARDIZED META CONTRACT
       * All evaluators expose blockType for downstream decisions.
       */
      blockType,
    },
  };
}