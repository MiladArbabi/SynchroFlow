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

    const isBlocked = !order.paid_at;

    const blockType = isBlocked
      ? 'awaiting_payment'
      : null;

    if (isBlocked) {
      console.debug('[CUSTOMER_CONSTRAINT_DETECTED]', {
        orderId,
        reason: 'awaiting_payment'
      });
    }

    await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: orderId })
      .update({
        customer_block_type: blockType
      });

  }

  console.debug('[customer_constraint_projection.completed]', {
    evaluated_orders: orderIds.length,
    blocked: 0
  });
}