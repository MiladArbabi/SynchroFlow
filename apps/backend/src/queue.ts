//apps/backend/src/queue.ts

import amqp from 'amqp-connection-manager';
import { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
// Heartbeat / reconnect tuning (seconds). Allows overriding via env in CI/dev.
// Provide sensible numeric defaults so TypeScript doesn't complain about missing identifiers.
const HEARTBEAT: number = Number(process.env.RABBITMQ_HEARTBEAT_SECONDS || process.env.RABBITMQ_HEARTBEAT || 5);
const RECONNECT: number = Number(process.env.RABBITMQ_RECONNECT_SECONDS || process.env.RABBITMQ_RECONNECT || 5);
// Allow tests/local runs to opt out of initializing Rabbit connections.
// Set DISABLE_QUEUE=1 in jest.setup (we already do this for tests).
export let connection: AmqpConnectionManager | null = null;

/**
 * CRITICAL ARCHITECTURAL RULE
 * ----------------------------
 * Queue connection MUST NEVER initialize at module load time.
 *
 * All connections must be established explicitly via initQueue().
 *
 * This guarantees:
 * - Deterministic CLI rebuilds
 * - No hidden side effects on import
 * - Predictable runtime boot order
 */

// extra safety: enforce disable in test env too
if (process.env.NODE_ENV === 'test') {
  process.env.DISABLE_QUEUE = '1';
}

const channels = new Map<string, ChannelWrapper>();

export async function initQueue(): Promise<void> {
  if (connection) return;
  connection = amqp.connect([RABBITMQ_URL], {
    heartbeatIntervalInSeconds: HEARTBEAT,
    reconnectTimeInSeconds: RECONNECT,
  });
  // Wait for the actual AMQP connection before returning
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('[QUEUE] RabbitMQ connection timeout after 15s'));
    }, 25000);
    connection!.once('connect', () => {
      clearTimeout(timeout);
      if (process.env.NODE_ENV !== 'test') {
        console.log('[api/queue.ts] Connected to RabbitMQ');
      }
      resolve();
    });
    connection!.once('connectFailed', ({ err }: { err: Error }) => {
      clearTimeout(timeout);
      reject(err);
    });
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
  /**
   * CRITICAL INVARIANT
   * -----------------
   * Queues MUST NOT silently no-op outside test environments.
   *
   * Silent no-op causes:
   * - Lost execution
   * - False progress signals
   * - Permanent FT2 blockers
   *
   * If this throws, fix environment or queue initialization.
   */

  // HARD GUARD — queues must never silently no-op outside tests
  if (!connection) {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        `[QUEUE_DISABLED] getQueueChannel("${queueName}") called with no active RabbitMQ connection.
          This is forbidden outside tests.
          Check DISABLE_QUEUE and initQueue() ordering.`
      );
    }

    // Test-only no-op channel
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
      // No topology declaration here.
      // Queue shape must be defined by the consumer layer.
      setup: async () => {}
    });

    /**
     * PROJECTION PROTOCOL ENFORCEMENT
     * --------------------------------
     * The 'events' queue is reserved exclusively for
     * canonical domain event projection triggers.
     *
     * Only messages of shape:
     *   { domain_event_id: number }
     * are permitted.
     *
     * Any attempt to publish other payloads will throw.
     */
    if (queueName === 'events') {
      const originalSend = channelWrapper.sendToQueue.bind(channelWrapper);

      channelWrapper.sendToQueue = (name: string, buffer: Buffer, options?: any) => {
        try {
          const parsed = JSON.parse(buffer.toString());
          const id = Number(parsed?.domain_event_id);

          if (!Number.isInteger(id)) {
            console.error('[QUEUE_PROTOCOL_VIOLATION_BLOCKED]', {
              queue: 'events',
              payload: parsed,
            });

            throw new Error(
              '[QUEUE_PROTOCOL_VIOLATION] events queue requires { domain_event_id: number }'
            );
          }
        } catch (err) {
          console.error('[QUEUE_PROTOCOL_INVALID_JSON]', {
            queue: 'events',
            raw: buffer.toString(),
          });
          throw err;
        }

        return originalSend(name, buffer, options);
      };
    }

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