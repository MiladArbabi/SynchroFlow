import { Knex } from 'knex';
import { resolveExternalOrderId } from '../../services/identity/resolveExternalOrder.service.js';

const ORDERS_PROJECTION = 'orders_projection';

export async function handleOrdersPaid({
  domainEvent,
  domain_event_id,
  canonicalEventTime,
  trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) {

  const payload = domainEvent.event_payload as any;
  const externalOrderId = String(payload.id);

  const lasyncroOrderId = await resolveExternalOrderId(
    domainEvent.shop_id,
    'shopify',
    externalOrderId
  );

  if (!lasyncroOrderId) {
    /**
     * CRITICAL DATA LOSS GUARD
     * ------------------------
     * Payment event without order reference.
     * Breaks revenue + fulfillment linkage.
     */
    console.error('[PROJECTION_ORDER_PAID_MISSING_ORDER_ID]', {
      reason: 'Missing lasyncroOrderId in paid event payload'
    });

    return;
  }

  /**
   * TRANSACTION CONTRACT
   * Projection engine owns the transaction boundary.
   * Handlers must reuse provided trx.
   */

    /**
     * CURSOR ENFORCEMENT MOVED
     * ------------------------
     * Projection ordering is now enforced centrally
     * in projection.engine.ts.
     *
     * Handlers must remain pure projection logic
     * without queue or cursor coordination.
     */

    const paymentTimestamp = canonicalEventTime;

    await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        payment_state: 'paid',
        paid_at: trx.raw('COALESCE(paid_at, ?)', [paymentTimestamp]),
        order_updated_at: paymentTimestamp,
        updated_at: paymentTimestamp,
      });

      /**
       * CURSOR ADVANCEMENT REMOVED
       * --------------------------
       * Projection engine centrally manages replay progress.
       * Handlers must remain pure projection logic.
       */
  };