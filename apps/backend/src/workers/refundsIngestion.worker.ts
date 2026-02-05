// apps/backend/src/workers/refundsIngestion.worker.ts

import db from 'api-src/db';
import { getQueueChannel } from 'api-src/queue';

/**
 * Refunds Ingestion Worker (Authoritative)
 * ---------------------------------------
 * Shopify refunds are the ONLY guaranteed signal
 * of revenue regression.
 *
 * This worker:
 * - Consumes staged refunds/create events
 * - Writes refunded quantities per SKU
 * - Is idempotent by design
 */
export async function processRefund(msg: any) {
  const { staged_event_id } = JSON.parse(msg.content.toString());

  const staged = await db('staged_events')
    .where({ id: staged_event_id })
    .first();

  if (!staged) {
    getQueueChannel('refunds.ingestion').ack(msg);
    return;
  }

  const payload = staged.raw_payload;
  const shopId = staged.shop_id;

  const platformOrderId = payload?.order_id;
  const refundLineItems = payload?.refund_line_items;

  if (!platformOrderId || !Array.isArray(refundLineItems)) {
    getQueueChannel('refunds.ingestion').ack(msg);
    return;
  }

  const canonicalOrder = await db('canonical_orders')
    .where({ platform_order_id: String(platformOrderId) })
    .first();

  if (!canonicalOrder) {
    // Order not resolved yet → safe to drop (refund will re-appear via replay if needed)
    getQueueChannel('refunds.ingestion').ack(msg);
    return;
  }

  await db.transaction(async trx => {
    for (const rli of refundLineItems) {
      const sku = rli?.line_item?.sku;
      const qty = Number(rli?.quantity);

      if (!sku || !Number.isFinite(qty) || qty <= 0) continue;

      await trx('order_revenue_units')
        .where({
          shop_id: shopId,
          canonical_order_id: canonicalOrder.canonical_order_id,
          sku,
        })
        .increment('returned_quantity', qty)
        .update({
          has_return_block: true,
          return_block_reason: 'customer_refunded',
          return_evaluated_at: trx.fn.now(),
        });
    }
  });

  getQueueChannel('refunds.ingestion').ack(msg);
}

/**
 * Worker entrypoint
 */
export function startRefundsIngestionWorker() {
  const channel = getQueueChannel('refunds.ingestion');
  channel.consume('refunds.ingestion', processRefund, { noAck: false });
};