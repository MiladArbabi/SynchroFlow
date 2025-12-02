// packages/api/src/queue.ts
import amqp from 'amqp-connection-manager';
import { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { Channel } from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

// 1. Add heartbeat to keep connection alive and detect drops faster
export const connection: AmqpConnectionManager = amqp.connect([RABBITMQ_URL], {
  heartbeatIntervalInSeconds: 5,
  reconnectTimeInSeconds: 5,
});

connection.on('connect', () => console.log('[api/queue.ts] Connected to RabbitMQ'));
connection.on('disconnect', (e: { err: Error }) => {
    // Use console.error so it stands out in logs
    console.error('[api/queue.ts] Disconnected from RabbitMQ:', e.err?.message);
});

const channels = new Map<string, ChannelWrapper>();

export const getQueueChannel = (queueName: string): ChannelWrapper => {
  if (!channels.has(queueName)) {
    const channelWrapper = connection.createChannel({
      json: false,
      setup: (channel: Channel) => {
        return channel.assertQueue(queueName, { durable: true });
      }
    });

    // Handle channel-specific errors
    // Without this, a channel error (like "Precondition Failed") crashes the whole app
    channelWrapper.on('error', (err) => {
        console.error(`[api/queue.ts] Error in channel for queue "${queueName}":`, err.message);
    });
    
    channelWrapper.on('close', () => {
        console.warn(`[api/queue.ts] Channel for queue "${queueName}" closed`);
    });

    channels.set(queueName, channelWrapper);
  }
  return channels.get(queueName)!;
};