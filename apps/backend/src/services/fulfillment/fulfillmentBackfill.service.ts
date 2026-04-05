import db from '@lasyncro/backend-core/db.js';
import { Knex } from 'knex';

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
  trx,
}: {
  shopId: number;
  orderId: string;
  fulfillmentStatus?: string | null;
  eventTime: Date;
  trx: Knex.Transaction;
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

  /**
   * TRANSACTIONAL INSERT (CRITICAL FIX)
   * ------------------------------------
   * Must use trx (not db) to stay inside the sync transaction.
   * Using db directly causes:
   * - sequence gaps when parent transaction rolls back
   * - out-of-transaction writes that survive rollback
   *
   * external_event_id enables conflict detection WITHOUT
   * sequence consumption — onConflict().ignore() on a partial
   * index does not allocate a sequence ID when the row exists.
   */
  await trx('domain_events')
    .insert({
      shop_id: shopId,
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
      external_event_id: `${orderId}:${normalizedStatus}:backfill`,
    })
    .onConflict(
      trx.raw('(shop_id, external_event_id) WHERE external_event_id IS NOT NULL')
    )
    .ignore();

  /* console.info('[FULFILLMENT_EVENT_BACKFILLED]', {
    shopId,
    orderId,
    eventTime,
  }); */
}