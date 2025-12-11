// apps/backend/src/workers/specter-ingestion.worker.ts
 /**
  * Specter ingestion worker (FT0)
  *
  * Responsibilities (minimal FT0):
  * - Consume messages from the 'specter_events' queue.
  * - Each message is expected to be a JSON object with at least:
  *     { shopId: number, type: string, payload?: object, sessionDelta?: object, timestamp?: number }
  * - For each message: best-effort appendEvent(shopId, { type, payload, timestamp })
  *   and if sessionDelta present call recordShopSession(shopId, sessionDelta)
  *
  * Key improvements in this refactor:
  * - More observability: debug/log statements at all important lifecycle points.
  * - Defensive parsing and ack/nack behaviour so the worker never blocks the queue.
  * - Idempotent start/stop and clearer debug messages for easier local troubleshooting.
  */

import { getQueueChannel } from '../queue';
import debugLib from 'debug';
// session-store helpers (FT0)
import { appendEvent, recordShopSession } from 'modules-specter/store/session-store';

const debug = debugLib('worker:specter-ingest');

const QUEUE_NAME = 'specter_events';

let consumerTag: string | null = null;
let channel: any = null;
let started = false;

/** helper: short-safe stringify for logs */
const short = (obj: any) => {
  try { return JSON.stringify(obj, null, 0).slice(0, 300); } catch { return String(obj); }
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
export async function processSpecterMessage(msg: { content: Buffer } | null) {
  if (!msg) {
    debug('[processSpecterMessage] called with null msg (ignoring)');
    return;
  }

  debug('[processSpecterMessage] raw message received (truncated):', short(msg.content));

  const parsed = safeParse(msg.content);
  if (!parsed || typeof parsed !== 'object') {
    debug('[processSpecterMessage] invalid/empty payload — acking to discard');
    try { channel?.ack?.(msg as any); } catch (e) { debug('[processSpecterMessage] ack failed', (e as Error).message || e); }
    return;
  }

  const shopId = Number(parsed.shopId || parsed.shop_id || parsed.shop || 0);
  const type = String(parsed.type || parsed.event || 'unknown');
  const payload = parsed.payload ?? parsed.data ?? null;
  const sessionDelta = parsed.sessionDelta ?? parsed.session_delta ?? null;
  const timestamp = typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now();

  if (!shopId || Number.isNaN(shopId)) {
    debug('[processSpecterMessage] missing/invalid shopId — acking to discard', { parsed: short(parsed) });
    try { channel?.ack?.(msg as any); } catch (e) { debug('[processSpecterMessage] ack failed', (e as Error).message || e); }
    return;
  }

  // Fire-and-forget best-effort processing to avoid blocking the queue
  (async () => {
    try {
      debug('[processSpecterMessage] appendEvent start', { shopId, type });
      await appendEvent(shopId, { type, payload, timestamp });
      debug('[processSpecterMessage] appendEvent OK', { shopId, type });
    } catch (err) {
      debug('[processSpecterMessage] appendEvent FAILED (non-fatal)', { shopId, type, err: (err as Error).message || err });
    }

    if (sessionDelta && typeof sessionDelta === 'object') {
      try {
        const s = {
          shopId,
          sessionId: sessionDelta.sessionId ?? `s-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          createdAt: sessionDelta.createdAt ?? new Date().toISOString(),
          exitIntent: sessionDelta.exitIntent ?? false,
          ...sessionDelta
        } as any;
        debug('[processSpecterMessage] recordShopSession start', { shopId, sessionId: s.sessionId });
        await recordShopSession(shopId, s);
        debug('[processSpecterMessage] recordShopSession OK', { shopId, sessionId: s.sessionId });
      } catch (err) {
        debug('[processSpecterMessage] recordShopSession FAILED (non-fatal)', { shopId, err: (err as Error).message || err });
      }
    }
  })().catch(e => debug('[processSpecterMessage] unexpected async error', (e as Error).message || e));

  // Ack quickly — we do not wait for best-effort tasks to finish to maintain throughput.
  try {
    channel?.ack?.(msg as any);
    debug('[processSpecterMessage] message acked', { shopId });
  } catch (e) {
    debug('[processSpecterMessage] ack failed (non-fatal)', (e as Error).message || e);
  }
}

/** Start consumer (idempotent) */
export async function startSpecterIngestionWorker(): Promise<void> {
  if (started) {
    debug('startSpecterIngestionWorker: already started');
    return;
  }

  debug('startSpecterIngestionWorker: attempting to obtain queue channel for', QUEUE_NAME);
  try {
    channel = getQueueChannel(QUEUE_NAME);
    if (!channel) {
      debug('startSpecterIngestionWorker: no channel available (queue disabled or not configured)');
      return;
    }

    // Register consumer; getQueueChannel returns an object compatible with .consume returning a promise
    await channel.consume(QUEUE_NAME, processSpecterMessage, { noAck: false })
      .then((info: any) => {
        consumerTag = info?.consumerTag ?? null;
        debug('startSpecterIngestionWorker: consumer registered', { queue: QUEUE_NAME, consumerTag });
      })
      .catch((e: any) => {
        debug('startSpecterIngestionWorker: failed to register consumer (non-fatal)', e && (e as Error).message ? (e as Error).message : e);
      });

    started = true;
    debug('startSpecterIngestionWorker: started successfully');
  } catch (err) {
    debug('startSpecterIngestionWorker: unexpected error (non-fatal)', (err as Error).message || err);
  }
}

/** Stop consumer (idempotent) */
export async function stopSpecterIngestionWorker(): Promise<void> {
  if (!started) {
    debug('stopSpecterIngestionWorker: already stopped');
    return;
  }

  debug('stopSpecterIngestionWorker: attempting graceful stop');
  try {
    if (consumerTag && channel && typeof channel.cancel === 'function') {
      try {
        await channel.cancel(consumerTag);
        debug('stopSpecterIngestionWorker: consumer canceled', { consumerTag });
      } catch (e) {
        debug('stopSpecterIngestionWorker: cancel failed (non-fatal)', (e as Error).message || e);
      }
    } else {
      debug('stopSpecterIngestionWorker: no consumerTag or cancel method available');
    }
  } catch (err) {
    debug('stopSpecterIngestionWorker: unexpected error (non-fatal)', (err as Error).message || err);
  } finally {
    consumerTag = null;
    channel = null;
    started = false;
    debug('stopSpecterIngestionWorker: stopped');
  }
}