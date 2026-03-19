import { Knex } from 'knex';

/**
 * ORDER CUSTOMER CONSTRAINT PROJECTION
 * ------------------------------------
 * Source of truth writer for customer_block_type.
 *
 * Current deterministic rule (baseline):
 * - No active signal → NULL (not blocked)
 *
 * This projection exists to:
 * - establish canonical write path
 * - prevent evaluator dead state
 *
 * Future:
 * - plug real customer signals here (address issues, confirmations, etc.)
 */
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

      console.debug('[CUSTOMER_CONSTRAINT_DETECTED]', {
        orderId,
        reason: 'awaiting_payment'
      });
    }

    const existing = await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: orderId })
      .first();

    const prevBlockType = existing?.customer_block_type ?? null;

    const isTransitionToBlocked = !prevBlockType && blockType;
    const isTransitionToUnblocked = prevBlockType && !blockType;

    await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: orderId })
      .update({
        customer_block_type: blockType,
        ...(isTransitionToBlocked && { block_started_at: trx.fn.now() }),
        ...(isTransitionToUnblocked && { block_resolved_at: trx.fn.now() })
      });

    /**
     * LIFECYCLE INSTRUMENTATION
     */
    if (isTransitionToBlocked) {
      console.debug('[CUSTOMER_BLOCK_STARTED]', { orderId, blockType });
    }

    if (isTransitionToUnblocked) {
      console.debug('[CUSTOMER_BLOCK_RESOLVED]', { orderId, previous: prevBlockType });
    }

      // TODO (lifecycle):
      // - set block_started_at when transitioning NULL → blocked
      // - set block_resolved_at when transitioning blocked → NULL
  }

  console.debug('[customer_constraint_projection.completed]', {
    evaluated_orders: orderIds.length,
    blocked: blockedCount
  });
}