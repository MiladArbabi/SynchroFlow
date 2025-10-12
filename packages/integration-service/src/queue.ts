// packages/integration-service/src/queue.ts
import amqp from 'amqp-connection-manager';
import { ChannelWrapper } from 'amqp-connection-manager';
import { Channel } from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

// The library manages the connection for us.
const connection = amqp.connect([RABBITMQ_URL]);
let channelWrapper: ChannelWrapper | null = null;

// Log connection events for debugging
connection.on('connect', () => console.log('[queue.ts] Connected to RabbitMQ'));
connection.on('disconnect', (err) => console.log('[queue.ts] Disconnected from RabbitMQ', err));

// This setup function creates a channel that we can use to publish messages.
const setupChannel = async (channel: Channel) => {
  console.log('[queue.ts] Channel created');
};

channelWrapper = connection.createChannel({
  json: false, // We'll send plain strings/buffers
  setup: setupChannel
});


export async function publishToQueue(queueName: string, message: string) {
  if (!channelWrapper) {
    throw new Error('Channel wrapper is not available.');
  }

  try {
    // The channel wrapper handles the queue assertion and sending in one step.
    // It will wait for the connection to be ready before sending.
    await channelWrapper.sendToQueue(queueName, Buffer.from(message), { persistent: true });
    console.log(`[queue.ts] Sent message to queue: ${queueName}`);
  } catch (error) {
    console.error(`[queue.ts] Error sending message to queue ${queueName}:`, error);
    // Let the channel wrapper handle reconnection. We just need to log the error.
  }
}