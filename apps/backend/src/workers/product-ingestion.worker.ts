/**
 * Product Ingestion Worker (Sovereign Mode)
 * ------------------------------------------
 *
 * PURPOSE
 * -------
 * Legacy queue drain for product_ingestion.
 *
 * The canonical product layer has been removed.
 * Product identity now lives in:
 *   - products (sovereign table)
 *   - order_line_items (sovereign FK)
 *
 * This worker intentionally:
 *   - Performs NO canonical writes
 *   - Performs NO normalization
 *   - Preserves queue durability
 *   - Prevents message buildup
 *
 * Safe to remove once enqueueProductForIngestion
 * is fully deprecated.
 */

import { getQueueChannel } from '../queue.js';

const QUEUE_NAME = 'product_ingestion';

let started = false;
let channel: any = null;

export async function startProductIngestionWorker(): Promise<void> {
  if (started) return;

  channel = getQueueChannel(QUEUE_NAME);
  if (!channel) return;

  await channel.assertQueue(QUEUE_NAME, { durable: true });

  await channel.consume(
    QUEUE_NAME,
    async (msg: { content: Buffer } | null) => {
      if (!msg) return;

      try {
        const payload = msg.content?.toString();
        console.log('[product-ingestion][drain]', payload?.slice(0, 200));
      } catch {
        // swallow
      } finally {
        channel.ack(msg);
      }
    },
    { noAck: false }
  );

  started = true;
}

export async function stopProductIngestionWorker(): Promise<void> {
  started = false;
}
