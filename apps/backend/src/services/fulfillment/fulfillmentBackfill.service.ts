import db from '@lasyncro/backend-core/db.js';

/**
 * FULFILLMENT EVENT BACKFILL SERVICE
 * ----------------------------------
 * Ensures event completeness during initial sync.
 *
 * Shopify does NOT replay historical webhooks.
 * Therefore we must emit fulfillment events explicitly.
 */
export async function backfillFulfillmentEvent({
  shopId,
  orderId,
  fulfillmentStatus,
  eventTime,
}: {
  shopId: number;
  orderId: string;
  fulfillmentStatus?: string | null;
  eventTime: Date;
}) {

  if (fulfillmentStatus !== 'fulfilled') return;

  await db('domain_events')
    .insert({
      shop_id: shopId,
      event_type: 'orders.fulfilled',
      event_payload: {
        order_id: orderId,
        status: 'fulfilled',
      },
      event_time: eventTime,
      event_version: 1,
    })
    /**
     * IDEMPOTENCY GUARD
     * -----------------
     * Prevent duplicate emission during retries.
     */
    .onConflict(['shop_id', 'event_type', 'event_time'])
    .ignore();

  console.info('[FULFILLMENT_EVENT_BACKFILLED]', {
    shopId,
    orderId,
    eventTime,
  });
}