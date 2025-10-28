// packages/api/src/queue.ts
import amqp from 'amqp-connection-manager';
import { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { Channel } from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

// We export the connection so our worker can use it
export const connection: AmqpConnectionManager = amqp.connect([RABBITMQ_URL]);

connection.on('disconnect', (e: { err: Error }) => console.log('[api/queue.ts] Disconnected from RabbitMQ', e.err.message));

// We use a map to store our channels so we don't create them more than once
const channels = new Map<string, ChannelWrapper>();

export const getQueueChannel = (queueName: string): ChannelWrapper => {
  if (!channels.has(queueName)) {
    const channelWrapper = connection.createChannel({
      json: false,
      setup: (channel: Channel) => {
        return channel.assertQueue(queueName, { durable: true });
      }
    });
    channels.set(queueName, channelWrapper);
  }
  return channels.get(queueName)!;
};