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

import { withTenant } from '@lasyncro/backend-core/db.js';
import { getQueueChannel } from '../queue.js';

const QUEUE_NAME = 'product_ingestion';

let started = false;
let channel: any = null;
let consumerTag: string | null = null;
let attachmentPromise: Promise<void> | null = null;
let stopPromise: Promise<void> | null = null;
let acceptingDeliveries = false;
const activeDeliveries = new Set<Promise<void>>();
let deliveryFailures: unknown[] = [];

async function processProductIngestionMessage(
  msg: { content: Buffer } | null
): Promise<void> {
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

    await withTenant(Number(parsed.shopId), (trx) =>
      trx('domain_events').insert({
        shop_id: parsed.shopId,
        event_type: 'catalog/product_sync_received',
        event_payload: {
          ...parsed.rawProduct,
          id: String(parsed.rawProduct?.id).startsWith('gid://')
            ? String(parsed.rawProduct.id).split('/').pop()
            : parsed.rawProduct?.id,
        },
        event_time: new Date(),
        event_version: 1,
        external_event_id: `catalog_sync:${parsed.shopId}:${parsed.rawProduct?.id}`,
      })
    );
  } catch {
    // Preserve legacy behavior: failed ingestion is acknowledged below.
  } finally {
    channel.ack(msg);
  }
}

function ownProductDelivery(msg: { content: Buffer } | null): Promise<void> {
  if (!acceptingDeliveries) return Promise.resolve();

  let owned!: Promise<void>;
  owned = processProductIngestionMessage(msg)
    .catch((error) => {
      deliveryFailures.push(error);
      throw error;
    })
    .finally(() => {
      activeDeliveries.delete(owned);
    });
  activeDeliveries.add(owned);
  return owned;
}

function handleProductDelivery(msg: { content: Buffer } | null): void {
  void ownProductDelivery(msg).catch(() => undefined);
}

export function startProductIngestionWorker(): Promise<void> {
  if (stopPromise) {
    return stopPromise.then(() => startProductIngestionWorker());
  }
  if (attachmentPromise) return attachmentPromise;
  if (started) return Promise.resolve();

  channel = getQueueChannel(QUEUE_NAME);
  if (!channel) return Promise.resolve();
  acceptingDeliveries = true;
  deliveryFailures = [];

  const ownedChannel = channel;
  const attachment = (async () => {
    await ownedChannel.addSetup(async (ch: any) => {
      await ch.assertQueue(QUEUE_NAME, { durable: true });
    });

    if (!acceptingDeliveries) return;

    const reply = await ownedChannel.consume(
      QUEUE_NAME,
      handleProductDelivery,
      { noAck: false }
    );
    const ownedConsumerTag = reply?.consumerTag;
    if (!ownedConsumerTag) {
      throw new Error('[product-ingestion] consume() returned no consumerTag');
    }
    if (!acceptingDeliveries) {
      await ownedChannel.cancel(ownedConsumerTag);
      return;
    }
    consumerTag = ownedConsumerTag;
    started = true;
  })();

  let ownedAttachment!: Promise<void>;
  ownedAttachment = attachment.finally(() => {
    if (attachmentPromise === ownedAttachment) attachmentPromise = null;
  });
  attachmentPromise = ownedAttachment;
  return ownedAttachment.then(() => {
    if (started) {
      console.info('[product-ingestion] consumer attached', {
        queue: QUEUE_NAME
      });
    }
  });
}

export async function stopProductIngestionWorker(): Promise<void> {
  if (stopPromise) return stopPromise;

  acceptingDeliveries = false;
  started = false;
  const operation = (async () => {
    const failures: unknown[] = [];
    const attachment = attachmentPromise;
    if (attachment) {
      try { await attachment; } catch (error) { failures.push(error); }
    }

    const ownedTag = consumerTag;
    consumerTag = null;
    if (channel && ownedTag) {
      try { await channel.cancel(ownedTag); } catch (error) { failures.push(error); }
    }

    const deliveryResults = await Promise.allSettled(Array.from(activeDeliveries));
    for (const result of deliveryResults) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    failures.push(...deliveryFailures);
    deliveryFailures = [];
    channel = null;
    if (failures.length > 0) throw failures[0];
  })();

  let ownedStop!: Promise<void>;
  ownedStop = operation.finally(() => {
    if (stopPromise === ownedStop) stopPromise = null;
  });
  stopPromise = ownedStop;
  return ownedStop;
}
