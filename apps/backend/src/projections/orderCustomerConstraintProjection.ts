import { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';

const CONSTRAINT_NAMESPACE = 'a9b7c6d4-4f8a-4c1b-b7b6-1c9a2e5d7f91';

export async function projectOrderCustomerConstraints(
  trx: Knex.Transaction,
  orderIds: string[]
): Promise<void> {

  if (orderIds.length === 0) return;
  let blockedCount = 0;

  for (const orderId of orderIds) {

    // BASELINE CUSTOMER SIGNAL:
    // unpaid orders are customer-blocked (no payment confirmation)
    const order = await trx('orders')
      .where({ lasyncro_order_id: orderId })
      .first();

    if (!order) {
      console.error('[CUSTOMER_PROJECTION_INVARIANT_MISSING_ORDER]', { orderId });
      continue;
    }

    /**
     * CUSTOMER SIGNAL EVALUATION
     * --------------------------
     * Centralized decision point for all customer-side constraints.
     *
     * Current signals:
     * - awaiting_payment → order.paid_at is NULL
     *
     * Future:
     * - missing_address
     * - failed_validation
     * - customer_confirmation_required
     *
     * RULE:
     * - Only ONE active block type at a time (first-match priority)
     */
    let blockType: string | null = null;
    // SIGNAL: awaiting payment
    if (!order.paid_at) {
      blockType = 'awaiting_payment';
    }
    /**
     * REVERTED (2026-07-02): incorrectly added an incomplete_address
     * signal here earlier this session, believing this file was the
     * live customer-constraint writer. Confirmed via grep it has ZERO
     * live callers — orderConstraintProjection.ts (no "Customer" in
     * the name) is the real, live writer, invoked from
     * projection.engine.ts's projectDomainEventCore. See GH-1036 for
     * the full corrected investigation. Leaving this file's
     * awaiting_payment-only logic untouched, matching its last known
     * live behavior before this session's incorrect edit.
     */

    const constraintId = uuidv5(
      `customer:${orderId}`,
      CONSTRAINT_NAMESPACE
    );

    // 1. update
    const updated = await trx('order_constraints')
      .where({
        lasyncro_order_id: orderId,
        constraint_type: 'customer'
      })
      .update({
        block_type: blockType,
        is_active: !!blockType,
        resolved_at: blockType ? null : new Date()
      });

    // 2. insert if missing
    if (updated === 0) {
      await trx('order_constraints').insert({
        constraint_id: constraintId,
        lasyncro_order_id: orderId,
        constraint_type: 'customer',
        block_type: blockType,
        started_at: blockType ? new Date() : null,
        resolved_at: blockType ? null : new Date(),
        is_active: !!blockType,
        created_at: new Date()
      });
    }

    // logging
    /* if (blockType) {
      console.debug('[CUSTOMER_BLOCK_ACTIVE]', {
        orderId,
        blockType
      });
    } */

    // Derived state
    const isBlocked = blockType !== null;

    if (!blockType && !order.paid_at) {
      console.error('[CUSTOMER_CONSTRAINT_INCONSISTENT]', {
        orderId,
        reason: 'paid_at missing but no blockType assigned'
      });
    }

    if (isBlocked) {
      blockedCount++;

      /* console.debug('[CUSTOMER_CONSTRAINT_DETECTED]', {
        orderId,
        reason: 'awaiting_payment'
      }); */
    };

      // TODO (lifecycle):
      // - set block_started_at when transitioning NULL → blocked
      // - set block_resolved_at when transitioning blocked → NULL
  }

  /* console.debug('[customer_constraint_projection.completed]', {
    evaluated_orders: orderIds.length,
    blocked: blockedCount
  }); */
}