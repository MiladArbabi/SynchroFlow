import db from '@lasyncro/backend-core/db.js';
import { Knex } from 'knex';
import { resolveExternalOrderId } from '../../services/identity/resolveExternalOrder.service.js';
import { advanceCursor } from '../projection.engine.js';

const ORDERS_PROJECTION = 'orders_projection';

export async function handleOrdersPaid({
  domainEvent,
  domain_event_id,
  canonicalEventTime,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
}) {

  const payload = domainEvent.event_payload as any;
  const externalOrderId = String(payload.id);

  const lasyncroOrderId = await resolveExternalOrderId(
    domainEvent.shop_id,
    'shopify',
    externalOrderId
  );

  if (!lasyncroOrderId) return;

  await db.transaction(async (trx: Knex.Transaction) => {

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
  });
}