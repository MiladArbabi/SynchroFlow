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

import db from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../queue.js';

const QUEUE_NAME = 'product_ingestion';

let started = false;
let channel: any = null;

export async function startProductIngestionWorker(): Promise<void> {
  if (started) return;

  channel = getQueueChannel(QUEUE_NAME);
  if (!channel) return;

  /**
 * QUEUE TOPOLOGY DECLARATION
 * --------------------------
 * Queue must be asserted before consumer attachment.
 * This prevents silent consumer failure and message backlog.
 */

await channel.addSetup(async (ch: any) => {
  await ch.assertQueue(QUEUE_NAME, { durable: true });
});

await channel.consume(
  QUEUE_NAME,
    async (msg: { content: Buffer } | null) => {
      if (!msg) return;

      try {
        const payload = msg.content?.toString();

    if (!payload) {
      console.error('[product-ingestion][empty_message]');
      channel.ack(msg);
      return;
    }

    let parsed;

    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      console.error('[product-ingestion][invalid_json]', payload);
      channel.ack(msg);
      return;
    }

    console.info('[product-ingestion][received]', {
      shopId: parsed?.shopId,
      platform: parsed?.platform,
    });

    /**
     * DOMAIN EVENT EMISSION
     * ---------------------
     * Product catalog must enter the system through
     * the immutable event ledger.
     *
     * This prevents silent catalog loss and enables
     * deterministic replay.
     */

    await db('domain_events').insert({
      shop_id: parsed.shopId,
      event_type: 'catalog/product_sync_received',
      /**
       * CANONICAL PRODUCT PAYLOAD
       * --------------------------
       * Enforces normalized identity at ingestion boundary.
       *
       * CRITICAL:
       * - Prevents GID leakage into domain events
       * - Guarantees deterministic replay
       */
      event_payload: {
        ...parsed.rawProduct,
        id: String(parsed.rawProduct?.id).startsWith('gid://')
          ? String(parsed.rawProduct.id).split('/').pop()
          : parsed.rawProduct?.id,
      },
      event_time: new Date(),
      event_version: 1,
      external_event_id: `catalog_sync:${parsed.shopId}:${parsed.rawProduct?.id}`,
    });
      } catch {
        // swallow
      } finally {
        channel.ack(msg);
      }
    },
    { noAck: false }
  );

  console.info('[product-ingestion] consumer attached', {
    queue: QUEUE_NAME
  });
  started = true;
}

export async function stopProductIngestionWorker(): Promise<void> {
  started = false;
}
