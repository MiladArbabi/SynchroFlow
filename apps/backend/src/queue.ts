//apps/backend/src/queue.ts

import amqp from 'amqp-connection-manager';
import { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { Channel } from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
// Heartbeat / reconnect tuning (seconds). Allows overriding via env in CI/dev.
// Provide sensible numeric defaults so TypeScript doesn't complain about missing identifiers.
const HEARTBEAT: number = Number(process.env.RABBITMQ_HEARTBEAT_SECONDS || process.env.RABBITMQ_HEARTBEAT || 5);
const RECONNECT: number = Number(process.env.RABBITMQ_RECONNECT_SECONDS || process.env.RABBITMQ_RECONNECT || 5);
// Allow tests/local runs to opt out of initializing Rabbit connections.
// Set DISABLE_QUEUE=1 in jest.setup (we already do this for tests).
export let connection: AmqpConnectionManager | null = null;

// extra safety: enforce disable in test env too
if (process.env.NODE_ENV === 'test') {
  process.env.DISABLE_QUEUE = '1';
}

if (process.env.DISABLE_QUEUE === '1') {
  // Tests set this env var to avoid real network connections and log noise.
  // Provide a null connection and let getQueueChannel return a no-op channel.
  // Keep a lightweight debug log so CI can confirm opt-out behaviour.
  // eslint-disable-next-line no-console
  console.log('[api/queue.ts] Queue disabled via DISABLE_QUEUE=1 - using no-op channel for tests');
} else {
  // 1. Add heartbeat to keep connection alive and detect drops faster
  connection = amqp.connect([RABBITMQ_URL], {
    heartbeatIntervalInSeconds: 5,
    reconnectTimeInSeconds: 5,
  });

  connection.on('connect', () => console.log('[api/queue.ts] Connected to RabbitMQ'));
  connection.on('disconnect', (e: { err: Error }) => {
      // Use console.error so it stands out in logs
      console.error('[api/queue.ts] Disconnected from RabbitMQ:', e.err?.message);
  });
}

const channels = new Map<string, ChannelWrapper>();

export async function initQueue(): Promise<void> {
  if (connection) return;

  connection = amqp.connect([RABBITMQ_URL], {
    heartbeatIntervalInSeconds: HEARTBEAT,
    reconnectTimeInSeconds: RECONNECT,
  });

  // Guard logging to avoid "Cannot log after tests are done"
  connection.on('connect', () => {
    if (process.env.NODE_ENV !== 'test') {
      console.log('[api/queue.ts] Connected to RabbitMQ');
    }
  });
  connection.on('disconnect', (e: { err: Error }) => {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[api/queue.ts] Disconnected from RabbitMQ:', e.err?.message);
    }
  });
}

export async function closeQueue(): Promise<void> {
  // close channel wrappers first
  for (const [q, ch] of channels) {
    try { if (ch && typeof (ch as any).close === 'function') await (ch as any).close(); } catch (err) { /* ignore */ }
    channels.delete(q);
  }

  if (connection) {
    try { await connection.close(); } catch (err) { /* ignore */ }
    connection = null;
  }
}

export const getQueueChannel = (queueName: string): ChannelWrapper => {
  // If queue usage is disabled (e.g. in tests), return a stable no-op channel wrapper.
  if (!connection) {
    // Return a minimal channel-like wrapper that exposes sendToQueue + on/close/error handlers.
    // Type-assert to ChannelWrapper to satisfy callers; methods are no-ops.
    const noopWrapper: any = {
      sendToQueue: (_name: string, _buffer: Buffer) => true,
      on: (_ev: string, _fn: (...args: any[]) => void) => {},
      addSetup: (_fn: any) => {},
      publish: (_ex: string, _rk: string, _buf: Buffer) => true,
      close: () => Promise.resolve(),
    };
    return noopWrapper as ChannelWrapper;
  }

  if (!channels.has(queueName)) {
    if (!connection) {
      // lazy init if someone calls getQueueChannel directly
      // (initQueue is preferred at startup)
      // eslint-disable-next-line no-console
      console.warn('[api/queue.ts] getQueueChannel called before initQueue(); initializing connection lazily.');
      // fire-and-forget init; createChannel will still work as connection manager queues requests
      initQueue().catch((e) => {
        console.error('[api/queue.ts] Failed to init queue connection:', e && (e as any).message ? (e as any).message : e);
      });
    }

    const channelWrapper = (connection as AmqpConnectionManager).createChannel({
      json: false,
      setup: (channel: Channel) => {
        // Keep durable flag to ensure persistence
        return channel.assertQueue(queueName, { durable: true });
      }
    });

    // Keep channel error handling to avoid process crash
    channelWrapper.on('error', (err: any) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error(`[api/queue.ts] Error in channel for queue "${queueName}":`, err?.message || err);
      }
    });
    channelWrapper.on('close', () => {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[api/queue.ts] Channel for queue "${queueName}" closed`);
      }
    });

    channels.set(queueName, channelWrapper);
  }
  return channels.get(queueName)!;
};

// Backwards-compatible exports for existing code expecting `connection`
export { connection as _maybeConnection }; // use with caution — might be null in test mode