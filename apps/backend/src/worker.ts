// apps/backend/src/worker.ts
import { getQueueChannel } from './queue';
import db from './db';

// Lazily obtain the specific channel for 'events' so tests can safely mock getQueueChannel
let eventChannel: ReturnType<typeof getQueueChannel> | null = null;
function getEventChannel() {
  if (!eventChannel) {
    eventChannel = getQueueChannel('events');
  }
  return eventChannel as NonNullable<typeof eventChannel>;
}

// This is the function our test is targeting
export async function processMessage(msg: { content: Buffer } | null) {
  if (msg === null) {
    return;
  }

  const content = msg.content.toString();

  try {
    const { staged_event_id } = JSON.parse(content);

    if (!staged_event_id) {
      console.error('[worker] Message is missing staged_event_id');
      getEventChannel().ack(msg as any);
      return;
    }

    // 1) Load staged event
    const stagedEvent = await db('staged_events')
      .where({ id: staged_event_id })
      .first<{
        id: number;
        shop_id: number;
        raw_payload: Record<string, any>;
      }>();

    if (!stagedEvent) {
      console.error(
        `[worker] Staged event with id ${staged_event_id} not found.`,
      );
      getEventChannel().ack(msg as any);
      return;
    }

    // Sovereign model: ingestion handled elsewhere
    // Worker now only acknowledges staged event

    // 4) Success path → ack
    getEventChannel().ack(msg as any);
  } catch (error) {
    // Mapping / processing failed. Our current policy for FT0:
    // - Do not poison the queue for mapping/validation/runtime errors.
    // - Log the error and ACK the message so it is not retried endlessly.
    console.error('[worker] Error processing message:', error);
    try {
      getEventChannel().ack(msg as any);
    } catch (ackErr) {
      // If ack fails for some reason, log it (but avoid throwing from the handler).
      console.error('[worker] Failed to ack failed message:', ackErr);
    }
  }
}

// This function starts the consumer
export function startWorker() {
  console.log('[worker] Starting API worker...');
  getEventChannel().consume('events', processMessage, { noAck: false });
  console.log('[worker] Worker started. Waiting for events...');
}