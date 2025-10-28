// packages/api/src/worker.ts
import { Channel } from 'amqplib';
import { getQueueChannel } from './queue';
import db from './db';
import { transformPayload } from './transformer';

// Get the specific channel for 'events'
const eventChannel = getQueueChannel('events');

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
      eventChannel.ack(msg as any); // Acknowledge message to remove from queue
      return;
    }

    // Fetch the raw payload from the database
    const stagedEvent = await db('staged_events')
    .where({ id: staged_event_id })
    .first<{ id: number; shop_id: number; raw_payload: Record<string, any> }>();

    if (!stagedEvent) {
      console.error(`[worker] Staged event with id ${staged_event_id} not found.`);
      eventChannel.ack(msg as any);
      return;
    }
 
    // Fetch the mapping rules for the shop associated with the event
    const mappingRules = await db('data_mapping_rules')
    .where({ shop_id: stagedEvent.shop_id });

    // Transform the payload
    const transformedPayload = transformPayload(stagedEvent.raw_payload, mappingRules);

    console.log('[worker] Successfully transformed payload:', transformedPayload);    
    
    // Acknowledge the message was processed successfully
    eventChannel.ack(msg as any);
  } catch (error) {
    console.error('[worker] Error processing message:', error);
    // In case of error, we "nack" the message (negative acknowledgement)
    // and tell the queue not to re-queue it to avoid infinite loops.
    eventChannel.nack(msg as any, false, false);
  }
}

// This function starts the consumer
export function startWorker() {
  console.log('[worker] Starting API worker...');
  eventChannel.consume('events', processMessage, { noAck: false });
  console.log('[worker] Worker started. Waiting for events...');
}