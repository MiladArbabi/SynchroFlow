/**
 * Product ingestion worker (FT0)
 *
 * Responsibilities:
 * - Consume messages from the 'product_ingestion' queue
 * - Each message must be a JSON object:
 *     { shopId: number, platform: 'shopify', rawProduct: object }
 * - Best-effort call processProductMessage(msg)
 * - Ack quickly, never throw, never block the queue
 */

import { getQueueChannel } from '../queue';
import debugLib from 'debug';
import { processProductMessage } from './product-worker';

const debug = debugLib('worker:product-ingest');

const QUEUE_NAME = 'product_ingestion';

let consumerTag: string | null = null;
let channel: any = null;
let started = false;

/** helper: short-safe stringify for logs */
const short = (obj: any) => {
  try {
    return JSON.stringify(obj, null, 0).slice(0, 300);
  } catch {
    return String(obj);
  }
};

/** parse message safely */
function safeParse(content: Buffer | string): any | null {
  try {
    const s = typeof content === 'string' ? content : content.toString();
    if (!s || s.length === 0) return null;
    return JSON.parse(s);
  } catch (e) {
    debug('[safeParse] JSON error:', (e as Error).message || e);
    return null;
  }
}

/** Process a single queue message */
export async function processProductIngestionMessage(
  msg: { content: Buffer } | null
) {
  if (!msg) {
    debug('[processProductIngestionMessage] called with null msg (ignoring)');
    return;
  }

  console.log('[product-ingest] message received');

  debug(
    '[processProductIngestionMessage] raw message received (truncated):',
    short(msg.content)
  );

  const parsed = safeParse(msg.content);
  if (!parsed || typeof parsed !== 'object') {
    debug('[processProductIngestionMessage] invalid payload — acking');
    try {
      channel?.ack?.(msg as any);
    } catch (e) {
      debug('[processProductIngestionMessage] ack failed', (e as Error).message || e);
    }
    return;
  }

  const shopId = Number(parsed.shopId);
  const platform = parsed.platform;
  const rawProduct = parsed.rawProduct;

  if (!shopId || Number.isNaN(shopId) || !platform || !rawProduct) {
    debug(
      '[processProductIngestionMessage] missing required fields — acking',
      { parsed: short(parsed) }
    );
    try {
      channel?.ack?.(msg as any);
    } catch (e) {
      debug('[processProductIngestionMessage] ack failed', (e as Error).message || e);
    }
    return;
  }

  // Fire-and-forget best-effort processing
  (async () => {
    try {
      console.log('[product-ingest] delegating to processProductMessage', { shopId });
      debug('[processProductIngestionMessage] ingest start', { shopId });
      await processProductMessage({
        shopId,
        platform,
        rawProduct,
      });
      debug('[processProductIngestionMessage] ingest OK', { shopId });
    } catch (err) {
      debug(
        '[processProductIngestionMessage] ingest FAILED (non-fatal)',
        { shopId, err: (err as Error).message || err }
      );
    }
  })().catch((e) =>
    debug('[processProductIngestionMessage] unexpected async error', e)
  );

  // Ack immediately — never block the queue
  try {
    channel?.ack?.(msg as any);
    debug('[processProductIngestionMessage] message acked', { shopId });
  } catch (e) {
    debug('[processProductIngestionMessage] ack failed (non-fatal)', e);
  }
}

/** Start consumer (idempotent) */
export async function startProductIngestionWorker(): Promise<void> {
  if (started) {
    debug('startProductIngestionWorker: already started');
    return;
  }

  console.log('[product-ingest] worker starting');
  debug('startProductIngestionWorker: obtaining queue channel', QUEUE_NAME);

  try {
    channel = getQueueChannel(QUEUE_NAME);
    if (!channel) {
      debug('startProductIngestionWorker: no channel available');
      return;
    }

    // ✅ THIS IS "AT WORKER STARTUP"
    await channel.assertQueue(QUEUE_NAME, {
      durable: true,
    });
    debug('startProductIngestionWorker: queue asserted', { queue: QUEUE_NAME });

    await channel
      .consume(QUEUE_NAME, processProductIngestionMessage, { noAck: false })
      .then((info: any) => {
        consumerTag = info?.consumerTag ?? null;
        debug('startProductIngestionWorker: consumer registered', {
          queue: QUEUE_NAME,
          consumerTag,
        });
      });

    started = true;
    debug('startProductIngestionWorker: started');
  } catch (err) {
    debug(
      'startProductIngestionWorker: unexpected error (non-fatal)',
      (err as Error).message || err
    );
  }
}


/** Stop consumer (idempotent) */
export async function stopProductIngestionWorker(): Promise<void> {
  if (!started) {
    debug('stopProductIngestionWorker: already stopped');
    return;
  }

  debug('stopProductIngestionWorker: stopping');

  try {
    if (consumerTag && channel?.cancel) {
      await channel.cancel(consumerTag);
      debug('stopProductIngestionWorker: consumer canceled', { consumerTag });
    }
  } catch (e) {
    debug('stopProductIngestionWorker: cancel failed (non-fatal)', e);
  } finally {
    consumerTag = null;
    channel = null;
    started = false;
    debug('stopProductIngestionWorker: stopped');
  }
}
