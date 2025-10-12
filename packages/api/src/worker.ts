// packages/api/src/worker.ts
import { Channel } from 'amqplib';
import { channelWrapper } from './queue';
import db from './db';

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
      channelWrapper.ack(msg as any); // Acknowledge message to remove from queue
      return;
    }

    // Fetch the raw payload from the database
    const stagedEvent = await db('staged_events').where({ id: staged_event_id }).first();

    if (!stagedEvent) {
      console.error(`[worker] Staged event with id ${staged_event_id} not found.`);
      channelWrapper.ack(msg as any);
      return;
    }

    console.log('[worker] Processing staged event payload:', stagedEvent.raw_payload);
    
    // TODO: In the next step (#99), we will add the transformation logic here.
    
    // Acknowledge the message was processed successfully
    channelWrapper.ack(msg as any);
  } catch (error) {
    console.error('[worker] Error processing message:', error);
    // In case of error, we "nack" the message (negative acknowledgement)
    // and tell the queue not to re-queue it to avoid infinite loops.
    channelWrapper.nack(msg as any, false, false);
  }
}

// This function starts the consumer
export function startWorker() {
  console.log('[worker] Starting API worker...');
  channelWrapper.consume('events', processMessage, { noAck: false });
  console.log('[worker] Worker started. Waiting for events...');
}