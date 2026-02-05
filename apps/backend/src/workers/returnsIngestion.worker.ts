import db from 'api-src/db';
import { getQueueChannel } from 'api-src/queue';

/**
 * Returns ingestion worker.
 * Writes observed returns into canonical_returns.
 */
export async function processReturn(msg: any) {
  const { staged_event_id, retryCount = 0 } = JSON.parse(
    msg.content.toString()
  );

  const staged = await db('staged_events')
    .where({ id: staged_event_id })
    .first();

  if (!staged) {
    getQueueChannel('returns.ingestion').ack(msg);
    return;
  }

  const payload = staged.raw_payload;
  const shopId = staged.shop_id;

  const platformOrderId = payload?.order?.id;
  const platformReturnId = payload?.id;

  if (!platformOrderId || !platformReturnId) {
    throw new Error('Missing platform order or return id');
  }

  const canonicalOrder = await db('canonical_orders')
    .where({ platform_order_id: platformOrderId })
    .first();

  if (!canonicalOrder) {
    console.warn(
      '[returns-ingestion] Canonical order not resolved yet, deferring',
      { shopId, platformOrderId }
    );

    // Requeue instead of crashing the worker
    const MAX_RETRIES = 5;

    if (retryCount >= MAX_RETRIES) {
      console.error(
        '[returns-ingestion] Max retries exceeded, parking return',
        { shopId, platformOrderId, retryCount }
      );

      // Ack to stop infinite loop (future: dead-letter table)
      getQueueChannel('returns.ingestion').ack(msg);
      return;
    }

    // Re-enqueue with incremented retry count
    getQueueChannel('returns.ingestion').sendToQueue(
      'returns.ingestion',
      Buffer.from(
        JSON.stringify({
          staged_event_id,
          retryCount: retryCount + 1,
        })
      )
    );

    // Ack the current message
    getQueueChannel('returns.ingestion').ack(msg);
    return;
  }

    const canonicalReturnId = `cr:v1:shopify:${shopId}:${platformReturnId}`;

      await db.transaction(async (trx) => {
      await trx('canonical_returns')
        .insert({
          canonical_return_id: canonicalReturnId,
          canonical_order_id: canonicalOrder.canonical_order_id,
          shop_id: shopId,
          return_initiated_at: payload.created_at,
          execution_source: 'observed',
        })
        .onConflict('canonical_return_id')
        .ignore();
      
      getQueueChannel('returns.enrichment.v1').sendToQueue(
        'returns.enrichment.v1',
        Buffer.from(
          JSON.stringify({
            canonical_return_id: canonicalReturnId,
          })
        )
      );

      const skus: string[] =
        payload?.return_line_items?.map((li: any) => li.sku) ?? [];

      if (skus.length === 0) return;

      await trx('order_revenue_units')
        .where({
          shop_id: shopId,
          canonical_order_id: canonicalOrder.canonical_order_id,
        })
        .whereIn('sku', skus)
        .update({
          has_return_block: true,
          return_block_reason: 'customer_returned',
          return_evaluated_at: trx.fn.now(),
        });
    });

  getQueueChannel('returns.ingestion').ack(msg);
}

/**
 * Worker entrypoint
 * -----------------
 * Contract:
 * - Must be explicitly started from worker-entry.ts
 * - Owns exactly one queue: returns.ingestion
 */
export function startWorker() {
  const channel = getQueueChannel('returns.ingestion');
  channel.consume('returns.ingestion', processReturn, { noAck: false });
}
