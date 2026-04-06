import { Knex } from 'knex';
import { ConstraintEvaluationResult } from '../constraint.types.js';

/**
 * OPERATIONAL CONSTRAINT EVALUATOR
 * --------------------------------
 * Source of truth:
 * - order_fulfillment_status.status
 * - order_age_snapshot.age_since_paid_seconds
 * - shop_operational_settings.fulfillment_sla_hours
 *
 * Definition:
 * - Order is operationally blocked if:
 *   pending fulfillment AND exceeds SLA
 *
 * This is deterministic and replay-safe.
 */
export async function evaluateOperationalConstraint(
  trx: Knex.Transaction,
  orderId: string,
  shopId: number
): Promise<ConstraintEvaluationResult> {

  const ofs = await trx('order_fulfillment_status')
    .where({ lasyncro_order_id: orderId })
    .first();

  if (!ofs) {
    throw new Error('[OPERATIONAL_CONSTRAINT_INVARIANT] fulfillment status missing');
  }

  const ageRow = await trx('order_age_snapshot')
    .where({ lasyncro_order_id: orderId })
    .first();

  if (!ageRow) {
    throw new Error('[OPERATIONAL_CONSTRAINT_INVARIANT] age snapshot missing');
  }

  const settings = await trx('shop_operational_settings')
    .where({ shop_id: shopId })
    .first();

  const slaSeconds = (settings?.fulfillment_sla_hours ?? 24) * 3600;

  const isBlocked =
    ofs.status === 'pending' &&
    Number(ageRow.age_since_paid_seconds ?? 0) >= slaSeconds;

  /**
   * Deterministic classification
   */
  const blockType = isBlocked ? 'sla_breach' : null;

  /* console.debug('[OPERATIONAL_CONSTRAINT_EVALUATED]', {
    orderId,
    isBlocked,
    blockType,
    age: ageRow.age_since_paid_seconds,
    slaSeconds
  }); */

  return {
    type: 'operational',
    isActive: isBlocked,
    meta: {
      /**
       * STANDARDIZED META CONTRACT
       * --------------------------
       * All evaluators MUST expose blockType for downstream decisions.
       */
      blockType
    }
  };
}