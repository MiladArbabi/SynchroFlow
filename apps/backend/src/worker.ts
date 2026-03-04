// apps/backend/src/worker.ts

import { getQueueChannel } from './queue.js';
import { projectDomainEventFromMessage } from './projection/projection.engine.js';

/**
 * WORKER TRANSPORT ADAPTER
 * -------------------------
 * Handles RabbitMQ delivery semantics only.
 */

let eventChannel: ReturnType<typeof getQueueChannel> | null = null;

function getEventChannel() {
  if (!eventChannel) {
    eventChannel = getQueueChannel('events');
  }
  return eventChannel as NonNullable<typeof eventChannel>;
}

async function processMessage(msg: { content: Buffer } | null) {
  try {
    await projectDomainEventFromMessage(msg);

    if (msg && 'fields' in (msg as any)) {
      getEventChannel().ack(msg as any);
    }
  } catch (error) {
    if (msg && 'fields' in (msg as any)) {
      try {
        getEventChannel().nack(msg as any, false, false);
      } catch (nackError) {
        console.error(
          '[worker] Failed to nack message after processing error:',
          nackError
        );
      }
    }

    throw error;
  }
}

export function startWorker() {
  console.log('[worker] Starting unified canonical worker...');

  const channel = getEventChannel();

  channel.addSetup(async (ch: any) => {

    await ch.assertExchange('events.dlx', 'direct', { durable: true });

    await ch.assertQueue('events', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'events.dlx',
        'x-dead-letter-routing-key': 'dead'
      }
    });

    await ch.assertQueue('events.dead', { durable: true });
    await ch.bindQueue('events.dead', 'events.dlx', 'dead');

    await ch.prefetch(1);

    await ch.consume('events', processMessage, { noAck: false });

  });

  console.log('[worker] Worker ready. Awaiting domain events...');
}