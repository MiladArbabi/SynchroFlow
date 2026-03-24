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

  /**
   * NORMALIZE INPUT (CRITICAL)
   * --------------------------
   * Shopify sends UPPERCASE statuses.
   * All comparisons must be lowercase.
   */
  const normalizedInput = fulfillmentStatus.toLowerCase();

  /**
   * STATUS NORMALIZATION (CANONICAL ENUM)
   * -------------------------------------
   * MUST match OrderFulfillmentIngestionService.precedence keys exactly.
   *
   * Invalid enums silently collapse to lowest precedence (pending),
   * corrupting fulfillment state.
   */
  const normalizedStatus =
    normalizedInput === 'partially_fulfilled'
      ? 'partially_fulfilled'
      : normalizedInput === 'fulfilled'
        ? 'fulfilled'
        : 'pending';

  await db('domain_events')
    .insert({
      shop_id: shopId,
      /**
       * EVENT TYPE (CANONICAL — SLASH FORMAT)
       * --------------------------------------
       * SYSTEM INVARIANT:
       * All domain events MUST use slash notation.
       *
       * Prevents:
       * - projection handler misses
       * - rebuild divergence
       * - dual event namespaces
       */
      event_type:
        normalizedInput === 'fulfilled'
          ? 'orders/fulfilled'
          : 'orders/fulfillment_updated',
      event_payload: {
        order_id: orderId,
        status: normalizedStatus,
      },
      event_time: eventTime,
      event_version: 1,
    })
    /**
     * IDEMPOTENCY GUARD
     * -----------------
     * Prevent duplicate emission during retries.
     */
    .onConflict()
    .ignore();

  /* console.info('[FULFILLMENT_EVENT_BACKFILLED]', {
    shopId,
    orderId,
    eventTime,
  }); */
}