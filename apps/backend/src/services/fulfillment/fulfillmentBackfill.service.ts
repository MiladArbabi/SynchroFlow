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

  /**
   * CRITICAL: always emit fulfillment state
   * ---------------------------------------
   * Event sourcing requires full state reconstruction.
   * Missing events = corrupted projections.
   */
  if (!fulfillmentStatus) return;

  await db('domain_events')
    .insert({
      shop_id: shopId,
      event_type: 'orders.fulfillment_status_updated',
      event_payload: {
        order_id: orderId,
        status: fulfillmentStatus,
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