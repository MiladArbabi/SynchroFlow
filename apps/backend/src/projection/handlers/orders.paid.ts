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

    const cursorRow = await trx('projection_cursors')
      .where({ projection_name: ORDERS_PROJECTION })
      .forUpdate()
      .first<{ last_processed_event_id: number }>();

    if (
      cursorRow?.last_processed_event_id != null &&
      domain_event_id <= cursorRow.last_processed_event_id
    ) {
      throw new Error(
        `[PROJECTION_ORDER_VIOLATION] last=${cursorRow.last_processed_event_id} got=${domain_event_id}`
      );
    }

    const paymentTimestamp = canonicalEventTime;

    const eventRow = await trx('domain_events')
      .where({ id: domain_event_id })
      .first();

    await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        payment_state: 'paid',
        paid_at: trx.raw('COALESCE(paid_at, ?)', [paymentTimestamp]),
        order_updated_at: paymentTimestamp,
        updated_at: paymentTimestamp,
      });

    await advanceCursor(
      trx,
      ORDERS_PROJECTION,
      domain_event_id,
      eventRow.event_time
    );
  });
}